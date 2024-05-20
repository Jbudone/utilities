const { timeStamp, time } = require('console');
const ffmpeg = require('/usr/lib/node_modules/fluent-ffmpeg'),
    path = require('path'),
    assert = require('assert'),
    child_process = require('child_process'),
    fs = require('fs');

// node ./videocut.js --cut 13:54-14:03 15:00-16:00 ....

// TODO:
//  - fix fadeDuration (which in turn needs fix for freeze/stutter/pixelation)
//      fix stutter/pixelation  from non-merged -> merged video concat   (only happens from non-merged to merged, not other way)
//                              might be due to inconsistent bitrate in merged vs. non-merged videos?
//                              will also need to pull input video information (eg. profile, level, framerate, etc.) when re-encoding
//  - probe video to see how memory intensive this is: 3 possible approaches (all in one complex filter graph, trim commands + one filter graph for all merging, trim commands + one filter graph per merge)
//  - cleanup intermediate files
//  - potentially allow lowering quality? eg. bitrate, pixel quality, etc.
//  - progress bar
//  - sanitize read args
//      - file exists, output file does not exist
//      - timecuts are ordered correctly and don't overlap
//      - timecuts fit within range of duration
//      
// NOTE:
//  - we COULD use a complex filter graph for the whole video, but its fairly memory intensive and can cause system instability
//      we might be able to fix that somewhat by optimizing the graph, but otherwise its probably safer to trim over multiple commands



const args = process.argv.slice(2);
console.log(args);

const file = args[0];
const fileExtension = path.extname(file);
const fileBaseName = path.basename(file, fileExtension);
const fileDirectory = path.dirname(file);
const output = path.join(fileDirectory, fileBaseName + '.out' + fileExtension);


console.log('Starting directory: ' + process.cwd());
process.chdir(fileDirectory);
console.log('New directory: ' + process.cwd());

console.log(`Cutting video: ${file} -> ${output}`);
  




// FIXME: The fade works, but concatenating that fade file seems borked; disabling for now
const fadeDuration = 0;




const timestampToSeconds = (timestampStr) => {
    const timestampParts = timestampStr.match(/^(\d{1,2}:)?(\d{1,2}:)?(\d{1,2})$/);
    assert(timestampParts && timestampParts.length === 4, `Failed to parse timestamp: ${timestampStr}`);
    assert(timestampParts[3] != undefined, `Failed to parse timestamp: ${timestampStr}`);

    let parts = [];
    if (timestampParts[1] != undefined) parts.push(timestampParts[1].replace(':', ''));
    if (timestampParts[2] != undefined) parts.push(timestampParts[2].replace(':', ''));
    if (timestampParts[3] != undefined) parts.push(timestampParts[3].replace(':', ''));

    let totalTime = 0;
    for (let i = 0 ; i < parts.length; ++i) {
        totalTime *= 60;
        totalTime += parseInt(parts[i], 10);
    }

    return totalTime;
};

const secondsToTimestamp = (timestampFull) => {
    const milliseconds = (timestampFull * 1000) % 1000,
        timestampSeconds = Math.floor(timestampFull),
        hours = Math.floor(timestampSeconds / 3600),
        minutes = Math.floor(timestampSeconds / 60) % 60,
        seconds = timestampSeconds % 60;
    
    return `${hours? hours + ':' : ''}${minutes? minutes + ':' : '0:'}${seconds.toString().padStart(2, '0')}`;//.${milliseconds.toString().padStart(3, '0')}`;
};





const getVideoDetails = async (videoFilePath) => {

    /*
    const ffprobeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,duration -of default=noprint_wrappers=1:nokey=1 "${videoFilePath}"`;
    return new Promise((resolve, reject) => {
        child_process.exec(ffprobeCmd, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            if (stderr) {
                reject(stderr);
                return;
            }

            const results = stdout.trim().split('\n');
            const pixelFormat = results[1].trim();
            const duration = parseInt(results[2].trim(), 10);
            const codec = results[0].trim();

            try {
                if (pixelFormat != "yuv420p")
                    throw new Error(`Error: Pixel Format is ${pixelFormat}, not yuv420p`);
                if (duration <= 0)
                    throw new Error(`Error: Duration is ${duration}, not valid`);
                if (codec != "h264")
                    throw new Error(`Error: Codec is ${codec}, not h264`);
            } catch (e) {
                console.log(e);
                process.exit(-1);
            }

            const encoders = {
                h264: "libx264",
            }

            const encoder = encoders[codec];


            resolve({ pixelFormat, duration, codec, encoder, file: videoFilePath });
        });
    });
    */

    const ffprobeCmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${videoFilePath}"`;
    return new Promise((resolve, reject) => {
        child_process.exec(ffprobeCmd, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            if (stderr) {
                reject(stderr);
                return;
            }

            const results = JSON.parse(stdout);

            try {
                if (!results.streams || results.streams.length === 0)
                    throw new Error(`Error: No streams found`);
                if (results.streams.filter(s => s.codec_type === "video").length != 1)
                    throw new Error(`Error: More than one video stream found`);
                if (results.streams.filter(s => s.codec_type === "audio").length != 1)
                    throw new Error(`Error: More than one audio stream found`);

                const videoStream = results.streams.filter(s => s.codec_type === "video")[0];
                const audioStream = results.streams.filter(s => s.codec_type === "audio")[0];
                if (videoStream.pix_fmt != "yuv420p")
                    throw new Error(`Error: Pixel Format is ${videoStream.pix_fmt}, not yuv420p`);
                if (videoStream.codec_name != "h264")
                    throw new Error(`Error: Codec is ${videoStream.codec_name}, not h264`);

                
                const encoders = {
                    h264: "libx264",
                }

                const encoder = encoders[videoStream.codec_name];

                resolve({
                    video: videoStream,
                    audio: audioStream,
                    encoder,
                    duration: parseFloat(results.format.duration),
                    file: videoFilePath,

                    pixelFormat: videoStream.pix_fmt,
                    codec: videoStream.codec_name
                });
            } catch (e) {
                console.log(e);
                process.exit(-1);
            }
        });
    });
}




// concatenate with fade
//const fileSrc = "/home/jbud/Desktop/deleteme/dota_left.mp4";
const concatLeft = "/home/jbud/Desktop/deleteme/dota_left.mp4";
const concatRight = "/home/jbud/Desktop/deleteme/dota_right.mp4";
const concatOut = "/home/jbud/Desktop/deleteme/dota_out.mp4";

let main = async () => {




    let inputVideoDetails = await getVideoDetails(file);
    let pixelFormat = inputVideoDetails.pixelFormat;
    let TOTAL_DURATION = inputVideoDetails.duration;

    const timesToCut = [
    //    { start: '0:00', end: '3:30' },
    //    { start: '12:07', end: '14:08' },
    //    { start: '16:42', end: '40:26' },
    //    { start: '46:30', end: TOTAL_DURATION }
    ];





    let previousArg = null;
    let readingCuts = false;
    for (let i = 1; i < args.length; ++i)
    {
        if (!readingCuts) {
            if (args[i] === "--cut")
            {
                readingCuts = true;
            }
            continue;
        }

        const timeToCutArg = args[i];
        if (timeToCutArg.indexOf('-') === -1)
            throw new Error(`Invalid timecut argument: ${timeToCutArg}`);
    
        const times = timeToCutArg.split('-');
        if (times.length != 2)
            throw new Error(`Invalid timecut argument: ${timeToCutArg}`);
    
        if (times[0] === "") {
            if (previousArg != null)
                throw new Error(`Invalid timecut argument: ${timeToCutArg}`);
            times[0] = "0:00";
        }

    
        let timeStart = timestampToSeconds(times[0]);

        if (times[1] === "") {
            times[1] = TOTAL_DURATION;
            timeEnd = TOTAL_DURATION;
        } else {
            timeEnd = timestampToSeconds(times[1]);
        }

        if (timeStart >= timeEnd)
            throw new Error(`Invalid timecut argument: ${timeToCutArg}`);
        if (previousArg != null && (timeStart - previousArg.end) <= fadeDuration)
            throw new Error(`Times to cut must be at least ${fadeDuration} seconds apart: ${previousArg.end} > ${timeStart}`);

        timesToCut.push({ start: timeStart, end: timeEnd });
    }
    
    
    let timesToKeep = [];
    let prevTime = 0;
    for (let i = 0; i < timesToCut.length; ++i)
    {
        const toCut = timesToCut[i];
        toCut.start = toCut.start;
        toCut.end = toCut.end;
    
        if (prevTime > toCut.start) {
            throw new Error(`Times to cut must be in order: ${prevTime} > ${toCut.start}`);
            process.exit(-1);
        }
    
        if (prevTime < toCut.start) {
    
            if (toCut.start - prevTime <= fadeDuration) {
                throw new Error(`Times to cut must be at least ${fadeDuration} seconds apart: ${prevTime} > ${toCut.start}`);
                process.exit(-1);
            }
    
            timesToKeep.push({
                start: prevTime,
                end: toCut.start
            });
        }
    
        prevTime = toCut.end;
    }
    
    if (prevTime < TOTAL_DURATION) {
        if (TOTAL_DURATION - prevTime <= fadeDuration) {
            throw new Error(`Times to cut must be at least ${fadeDuration} seconds apart: ${prevTime} > ${TOTAL_DURATION}`);
            process.exit(-1);
        }
    
        timesToKeep.push({
            start: prevTime,
            end: TOTAL_DURATION
        });
    }

    console.log(timesToKeep);
















    const videoList = [];

    let getNearestKeyframes = async (fileSrc, timestamp) => {
        // Find the nearest keyframes around the timestamp
        const keyframePadding = 10;
        let startTime = Math.max(0, timestamp - keyframePadding);

        return new Promise((resolve, reject) => {
            child_process.exec(`ffprobe -read_intervals ${startTime}%+${keyframePadding * 2} -select_streams v:0 -show_entries packet=pts_time,flags -of csv ${fileSrc} | grep -i ',K__$'`, (error, stdout, stderr) => {
                if (error) {
                    console.log(error);
                    process.exit(-1);
                }

                const results = stdout.trim().split('\n');
                const ptsTimes = results.map(result => {
                    const ptsTime = parseFloat(result.split(',')[1]);
                    return ptsTime;
                });

                let i;
                for (i = 0; i < (ptsTimes.length - 1); i++) {
                    if (ptsTimes[i] == timestamp) {
                        console.log("ERROR: keyframe is directly on timestamp, we don't have a way to handle this yet");
                        process.exit(-1);
                    }

                    if (ptsTimes[i] > timestamp) {
                        break;
                    }
                }

                const keyframeLeft = ptsTimes[i-1];
                const keyframeRight = ptsTimes[i];
                resolve({ keyframeLeft, keyframeRight });
            });
        });
    };

    // Trim video over multiple commands (not in complex filter)
    let trimVideo = async (fileSrc, fileDest, start, end, needsReencode) => {

        return new Promise((resolve, reject) => {
            let command = ffmpeg();
            command.input(fileSrc);
            command.inputOptions([
                `-ss ${start}`, `-to ${end}`
            ]);

            //if (needsReencode) {

            //} else {
                command = command.videoCodec('copy')
                                 .audioCodec('copy');
            //}

            command = command.on('end', () => {
                console.log('File has been concatenated successfully.');
                resolve(true);
            })
            .on('error', (err) => {
                console.error('An error occurred: ' + err.message);
                resolve(false);
            })
            .on('progress', function(progress) {
                //console.log('Processing: ' + progress.percent + '% done');
            })
            .on('stderr', function(stderrLine) {
                //console.log('Stderr output: ' + stderrLine);
            })
            .on('stdout', function(stdoutLine) {
                console.log('stdout output: ' + stdoutLine);
            })
            .save(fileDest);
        });
    };

    // FIXME: Use this for trimming only the whole parts of the video, not separating the fade portions into their own trims
    /*
    let prevFadeOffset = 0;
    for (let i = 0; i < timesToKeep.length; ++i) {
        const toKeep = timesToKeep[i];
        const videoDetails = {};
        videoDetails.fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${i}.mp4`;
        let trimResult = await trimVideo(file, videoDetails.fileSrc, toKeep.start, toKeep.end);

        if (!trimResult) {
            throw new Error("Error trimming video");
            process.exit(-1);
        }

        videoDetails.videoOutput = `${i}:v`;
        videoDetails.audioOutput = `${i}:a`;
        videoDetails.fadeDuration = fadeDuration;
        videoDetails.duration = toKeep.end - toKeep.start;
        videoDetails.fadeOffset = prevFadeOffset + videoDetails.duration - fadeDuration;
        prevFadeOffset = videoDetails.fadeOffset;
        videoList.push(videoDetails);
    }
    */


    


    // FIXME: each timeToKeep gets 2-3 trims: left fade(?), middle non-faded, right fade(?)
    //  The faded parts are merged together; then all parts are concatenated in the end
    let trimmedIdx = 0;
    {
        // FIXME: Adding support for cutting by keyframe, which makes faster and less buggy trim/cuts
        //  1. build list of keyframes
        //  2. build list of pre-trim cuts based off timesToKeep: [{ keyframeStart, keyframeEnd, cutStart, cutEnd }, ...]
        //  3. trim and build videoList: [{ fileSrc, duration, needsFade }, ...] 

        //  - trimVideo(..., DO_REENCODE)   : copy or re-encode based off keyframe selection
        //  - getNearestKeyframes
        //  - adjust trimming for fade consideration
        //  - may need to be careful with cutting without having the EXACT keyframe position, how do we specify EXACT keyframe and durations around that timestamp precision?

        // Get keyframes
        // `ffprobe -read_intervals 1:00%+10 -select_streams v:0 -show_entries packet=pts_time,flags -of csv original.mp4`
        //    -read_intervals  [start_time]%+[duration]
        //    -show_entries packet/frame  ; not clear on the difference between packet and frame, but packet at least gives timestamp of keyframe
        //    OUTPUT:
        //       packet,67.901167,___     <----  packet,[timestamp],___
        //       packet,67.934533,___              timestamp in seconds
        //       packet,67.967900,K__     <----  keyframe here
        //       packet,68.001267,___
        //       packet,68.034633,___
        //    NOTE: keyframe intervals are suggested to be 5-10 seconds
        //
        // Need to find each time range that we want to trim, then pad those times with keyframe range and run command, then find the nearest
        // timestamps padded off those times
        // 
        //   timesToKeep: [{ start, end }, { start, end }, ...]
        //      PAD EACH TIME TO NEAREST KEYFRAMES:
        //   padded:      [{ keyframeLeftOut, leftStart, keyframeLeftIn, keyframeRightIn, rightEnd, keyframeRightOut}, ...]
        //      TRIM EACH OF THESE (COPY) TO KEYFRAME RANGES   (NO RE-ENCODING NEEDED)
        //   keyframes:   [{ keyframeLeftOut, leftStart, keyframeLeftIn}, {keyframeLeftIn, keyframeRightIn}, {keyframeRightIn, rightEnd, keyframeRightOut}]
        //      THEN TRIM EACH TO ACTUAL TIME RANGE (NEEDS RE-ENCODING FOR LEFT/RIGHT)
        //   trimmed:     [{ left, needsFade? }, { middle }, { right, needsFade? }]
        //   
        //
        // FIXME: Need to handle situations with keyframe and trims overlapping; this MAY only need an assert since its unlikely
        //        we'll want to strip such a tiny portion out

        const paddedTimesToKeep = [];
        for (let i = 0; i < timesToKeep.length; ++i) {
            const toKeep = timesToKeep[i];

            //  CUT_LEFT  (FADE_LEFT |    KEEP     | FADE_RIGHT)  CUT_RIGHT
            //  ##########|,,,,,,,,,,|,,,,,,,,,,,,,|,,,,,,,,,,,|###########
            // <---    fadeEnd     start          end      fadeStart    --->


            if (fadeDuration > 0) {
                const fadeLeft = toKeep.start - fadeDuration,
                    fadeRight = toKeep.end + fadeDuration;
                assert(fadeLeft >= 0, "Fade left too early");
                assert(fadeRight < inputVideoDetails.duration, "Fade right too late");
    
                const fadeLeftKeyframeInfo = await getNearestKeyframes(file, fadeLeft),
                    fadeRightKeyframeInfo = await getNearestKeyframes(file, fadeRight),
                    startKeyframeInfo = await getNearestKeyframes(file, toKeep.start),
                    endKeyframeInfo = await getNearestKeyframes(file, toKeep.end);
                assert(startKeyframeInfo.keyframeRight - fadeLeftKeyframeInfo.keyframeLeft >= fadeDuration, "Fade cut too small");
                assert(fadeRightKeyframeInfo.keyframeRight - endKeyframeInfo.keyframeLeft >= fadeDuration, "Fade cut too small");
                
                
                // trim: re-encode
                paddedTimesToKeep.push({
                    keyframeLeft: fadeLeftKeyframeInfo.keyframeLeft,
                    keyframeRight: startKeyframeInfo.keyframeRight,
                    fade: 'left' // (FADE, start]
                });
    
                // trim: copy
                paddedTimesToKeep.push({
                    keyframeLeft: startKeyframeInfo.keyframeRight,
                    keyframeRight: endKeyframeInfo.keyframeLeft,
                    fade: null // [start, end]
                })
            
                // trim: re-encode
                paddedTimesToKeep.push({
                    keyframeLeft: endKeyframeInfo.keyframeLeft,
                    keyframeRight: fadeRightKeyframeInfo.keyframeRight,
                    fade: 'right' // [end, FADE)
                });
            } else {
                const startKeyframeInfo = await getNearestKeyframes(file, toKeep.start),
                    endKeyframeInfo = await getNearestKeyframes(file, toKeep.end);

                // trim: copy
                paddedTimesToKeep.push({
                    keyframeLeft: startKeyframeInfo.keyframeRight,
                    keyframeRight: endKeyframeInfo.keyframeLeft,
                    fade: null // [start, end]
                });
            }

        }

        // Trim individual parts to come up with list of all extracted clips
        //const DO_REENCODE = true;
        for (let i = 0; i < paddedTimesToKeep.length; ++i) {
            const toKeep = paddedTimesToKeep[i];

            // NOTE: We can skip the left fade in for first toKeep part (beginning of video)
            if (toKeep.fade === 'left' && i > 0) {
                let fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                let trimResult = await trimVideo(file, fileSrc, toKeep.keyframeLeft, toKeep.keyframeRight);
                assert(trimResult, "Error trimming video");
                ++trimmedIdx;

                videoList.push({
                    fileSrc: fileSrc,
                    duration: (toKeep.keyframeRight - toKeep.keyframeLeft),
                    needsFade: true,
                    srcStart: toKeep.keyframeLeft,
                    srcEnd: toKeep.keyframeRight
                });
            }

            if (toKeep.fade === null) {
                let fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                let trimResult = await trimVideo(file, fileSrc, toKeep.keyframeLeft, toKeep.keyframeRight);
                assert(trimResult, "Error trimming video");
                ++trimmedIdx;

                videoList.push({
                    fileSrc: fileSrc,
                    duration: (toKeep.keyframeRight - toKeep.keyframeLeft),
                    needsFade: false,
                    srcStart: toKeep.keyframeLeft,
                    srcEnd: toKeep.keyframeRight
                });
            }

            // NOTE: We can skip the right fade in for last toKeep (end of video)
            if (toKeep.fade === 'right' && i < paddedTimesToKeep.length - 1) {
                let fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                let trimResult = await trimVideo(file, fileSrc, toKeep.keyframeLeft, toKeep.keyframeRight);
                assert(trimResult, "Error trimming video");
                ++trimmedIdx;

                videoList.push({
                    fileSrc: fileSrc,
                    duration: (toKeep.keyframeRight - toKeep.keyframeLeft),
                    needsFade: true,
                    srcStart: toKeep.keyframeLeft,
                    srcEnd: toKeep.keyframeRight
                });
            }

            /*
            // [start, keyframeLeftIn]
            if (toKeep.trim === 'left')
            {
                // trim: [keframeLeftOut, keyframeLeftIn]
                let fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                let trimResult = await trimVideo(file, fileSrc, toKeep.keyframeLeft, toKeep.keyframeRight, !DO_REENCODE);
                assert(trimResult, "Error trimming video");
                ++trimmedIdx;

                // trim: [start, keyframeLeftIn]
                // NOTE: Need to adjust time to new range from above file
                const trimmedFileSrc = fileSrc;
                fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                trimResult = await trimVideo(trimmedFileSrc, fileSrc, toKeep.trimPoint - toKeep.keyframeLeft, toKeep.keyframeRight - toKeep.keyframeLeft, DO_REENCODE);
                assert(trimResult, "Error trimming video");
                ++trimmedIdx;

                // FIXME: Need to adjust for fade
                videoList.push({
                    fileSrc: fileSrc,
                    duration: (toKeep.keyframeRight - toKeep.trimPoint),
                    needsFade: true
                });
            }

            // [keyframeLeftIn, keyframeRightIn]
            if (toKeep.trim === null)
            {
                // trim: [keyframeLeftIn, keyframeRightIn]
                fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                trimResult = await trimVideo(file, fileSrc, toKeep.keyframeLeft, toKeep.keyframeRight, !DO_REENCODE);
                assert(trimResult, "Error trimming video");
                ++trimmedIdx;

                // FIXME: Need to adjust for fade
                videoList.push({
                    fileSrc: fileSrc,
                    duration: (toKeep.keyframeRight - toKeep.keyframeLeft),
                    needsFade: false
                });
            }

            // [keyframeRightIn, end]
            if (toKeep.trim === 'right')
            {
                // trim: [keyframeRightIn, keyframeRightOut]
                let fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                let trimResult = await trimVideo(file, fileSrc, toKeep.keyframeLeft, toKeep.keyframeRight, !DO_REENCODE);
                assert(trimResult, "Error trimming video");
                ++trimmedIdx;

                // trim: [keyframeRightIn, end]
                // NOTE: Need to adjust time to new range from above file
                const trimmedFileSrc = fileSrc;
                fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                trimResult = await trimVideo(trimmedFileSrc, fileSrc, 0, toKeep.trimPoint - toKeep.keyframeLeft, DO_REENCODE);
                assert(trimResult, "Error trimming video");
                ++trimmedIdx;

                // FIXME: Need to adjust for fade
                videoList.push({
                    fileSrc: fileSrc,
                    duration: (toKeep.trimPoint - toKeep.keyframeRight),
                    needsFade: false
                });
            }
            */
        }


        /*
        // FIXME: The below doesn't take keyframes into consideration, replace below with keyframe rework
        for (let i = 0; i < timesToKeep.length; ++i) {
            const toKeep = timesToKeep[i];


            // Left Trim?
            if (i > 0)
            {
                const fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                let trimResult = await trimVideo(file, fileSrc, toKeep.start, toKeep.start + fadeDuration);
                assert(trimResult, "Error trimming video");

                videoList.push({
                    fileSrc: fileSrc,
                    duration: fadeDuration,
                    needsFade: true
                });
                ++trimmedIdx;
            }


            // Middle Trim
            {
                let duration = toKeep.end - toKeep.start,
                    start = toKeep.start,
                    end = toKeep.end;

                if (i > 0) { duration -= fadeDuration; start += fadeDuration; }
                if (i < timesToKeep.length - 1) { duration -= fadeDuration; end -= fadeDuration; }

                const fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                let trimResult = await trimVideo(file, fileSrc, start, end);
                assert(trimResult, "Error trimming video");

                videoList.push({
                    fileSrc: fileSrc,
                    duration: duration,
                    needsFade: false
                });
                ++trimmedIdx;
            }



            // Right Trim?
            if (i < timesToKeep.length - 1)
            {
                const fileSrc = `/home/jbud/Desktop/deleteme/file_tmp${trimmedIdx}.mp4`;
                let trimResult = await trimVideo(file, fileSrc, toKeep.end - fadeDuration, toKeep.end);
                assert(trimResult, "Error trimming video");

                videoList.push({
                    fileSrc: fileSrc,
                    duration: fadeDuration,
                    needsFade: true
                });
                ++trimmedIdx;
            }
        }
        */
    }


    // FIXME: run fades in multiple complexFilter commands rather than all in one massive filter graph

    let mergeVideos = async (fileLeftSrc, fileRightSrc, fileDest, encoder, fadeOffset, fadeDuration, pixelFormat) => {



        // video filter
        const videoFilter = {
            filter: 'xfade',
            options: {
                transition: 'fadeblack',
                duration: fadeDuration,
                offset: fadeOffset
            },
            inputs: ['0:v', '1:v'],
            outputs: 'V'
        };

        // audio filter
        const audioFilter = {
            filter: 'acrossfade',
            options: {
                d: fadeDuration
            },
            inputs: ['0:a', '1:a'],
            outputs: 'A'
        };

        return new Promise((resolve, reject) => {
            //const logFile = `/home/jbud/Desktop/deleteme/${fileDest}.txt`;


            let command = ffmpeg();
            command.input(fileLeftSrc);
            command.input(fileRightSrc);
            command.complexFilter([videoFilter, audioFilter])
                .outputOptions(["-map [V]", "-map [A]",

                '-profile:v high',               // Main profile
                '-level 4.0',                    // Ensure compatibility
                '-preset slow',                  // Quality over speed
                //'-b:v 11987944',                   // Video bitrate
                //'-maxrate 11987944',               // Max rate
                //'-bufsize 23975888',               // Buffer size
                //'-g 10', // keyframe interval
                '-crf 1',
                '-r 29.97',                      // Frame rate
                '-pix_fmt yuv420p',              // Pixel format
                //'-b:a 189k',                     // Audio bitrate
                //'-ar 48000',                     // Audio sample rate
                //'-ac 2',                         // Stereo audio
                '-movflags +faststart',           // Enable web faststart

                //'-metadata:s:v handler_name="VideoHandler"',
                //'-metadata:s:a handler_name="SoundHandler"',
                //'-metadata:s:v encoder="AVC Coding"',
                //'-metadata:s:a encoder="Mainconcept MP4 Sound Media Handler"',
                '-video_track_timescale 30000',        // Set `tbn` to 30k
                //`-passlogfile ${logFile}`
                    //'-profile:v main', '-b:v 11987944', '-b:a 189k', // FIXME: Trying to force bitrate, but it seems to round off slightly and still break
                    //"-pix_fmt " + pixelFormat, "-map [A]"])
                ])
                .videoCodec(encoder)
                .audioCodec('aac')
                .on('end', () => {
                    console.log("Firstpass complete");
                    resolve(true);
                })
                .on('error', (err) => {
                    console.error('An error occurred: ' + err.message);
                    resolve(false);
                })
                .on('progress', function(progress) {
                    //console.log('Processing: ' + progress.percent + '% done');
                })
                .on('stderr', function(stderrLine) {
                    console.log('Stderr output: ' + stderrLine);
                })
                .on('stdout', function(stdoutLine) {
                    console.log('stdout output: ' + stdoutLine);
                })
                .save(fileDest);

            // 2-pass encoding
            /*
            let command = ffmpeg();
            command.input(fileLeftSrc);
            command.input(fileRightSrc);
            command.complexFilter([videoFilter, audioFilter])
                .outputOptions(["-map [V]", "-map [A]",

                '-profile:v main',               // Main profile
                '-level 4.0',                    // Ensure compatibility
                '-preset slow',                  // Quality over speed
                '-crf 0',
                //'-b:v 11987944',                   // Video bitrate
                //'-maxrate 11987944',               // Max rate
                //'-bufsize 23975888',               // Buffer size
                //'-g 10', // keyframe interval
                '-r 29.97',                      // Frame rate
                '-pix_fmt yuv420p',              // Pixel format
                '-pass 1', // first pass
                '-an', // no audio in first pass
                //'-b:a 189k',                     // Audio bitrate
                //'-ar 48000',                     // Audio sample rate
                //'-ac 2',                         // Stereo audio
                '-movflags +faststart',           // Enable web faststart

                //'-metadata:s:v handler_name="VideoHandler"',
                //'-metadata:s:a handler_name="SoundHandler"',
                //'-metadata:s:v encoder="AVC Coding"',
                //'-metadata:s:a encoder="Mainconcept MP4 Sound Media Handler"',
                '-video_track_timescale 30000',        // Set `tbn` to 30k
                //`-passlogfile ${logFile}`
                    //'-profile:v main', '-b:v 11987944', '-b:a 189k', // FIXME: Trying to force bitrate, but it seems to round off slightly and still break
                    //"-pix_fmt " + pixelFormat, "-map [A]"])
                ])
                .videoCodec(encoder)
                .audioCodec('aac')
                //.audioCodec('copy')
                .on('end', () => {
                    console.log("Firstpass complete");


                    let command = ffmpeg();
                    command.input(fileLeftSrc);
                    command.input(fileRightSrc);
                    command.complexFilter([videoFilter, audioFilter])
                        .outputOptions(["-map [V]", "-map [A]",
        
                        '-profile:v main',               // Main profile
                        '-level 4.0',                    // Ensure compatibility
                        '-preset slow',                  // Quality over speed
                        //'-b:v 11987944',                   // Video bitrate
                        //'-maxrate 11987944',               // Max rate
                        //'-bufsize 23975888',               // Buffer size
                        //'-g 10', // keyframe interval
                        '-crf 0',
                        '-r 29.97',                      // Frame rate
                        '-pix_fmt yuv420p',              // Pixel format
                        '-pass 2', // second pass
                        //'-b:a 189k',                     // Audio bitrate
                        //'-ar 48000',                     // Audio sample rate
                        //'-ac 2',                         // Stereo audio
                        '-movflags +faststart',           // Enable web faststart
        
                        //'-metadata:s:v handler_name="VideoHandler"',
                        //'-metadata:s:a handler_name="SoundHandler"',
                        //'-metadata:s:v encoder="AVC Coding"',
                        //'-metadata:s:a encoder="Mainconcept MP4 Sound Media Handler"',
                        '-video_track_timescale 30000',        // Set `tbn` to 30k
                        //`-passlogfile ${logFile}`
                            //'-profile:v main', '-b:v 11987944', '-b:a 189k', // FIXME: Trying to force bitrate, but it seems to round off slightly and still break
                            //"-pix_fmt " + pixelFormat, "-map [A]"])
                        ])
                        .videoCodec(encoder)
                        .audioCodec('aac')
                        .on('end', () => {
                            console.log("Firstpass complete");
                            resolve(true);
                        })
                        .on('error', (err) => {
                            console.error('An error occurred: ' + err.message);
                            resolve(false);
                        })
                        .on('progress', function(progress) {
                            //console.log('Processing: ' + progress.percent + '% done');
                        })
                        .on('stderr', function(stderrLine) {
                            //console.log('Stderr output: ' + stderrLine);
                        })
                        .on('stdout', function(stdoutLine) {
                            console.log('stdout output: ' + stdoutLine);
                        })
                        .save(fileDest);


                    //console.log('File has been merged successfully.');
                    //resolve(true);
                })
                .on('error', (err) => {
                    console.error('An error occurred: ' + err.message);
                    resolve(false);
                })
                .on('progress', function(progress) {
                    //console.log('Processing: ' + progress.percent + '% done');
                })
                .on('stderr', function(stderrLine) {
                    //console.log('Stderr output: ' + stderrLine);
                })
                .on('stdout', function(stdoutLine) {
                    console.log('stdout output: ' + stdoutLine);
                })
                .save('first_pass_output.mp4');
                */
        });
    };



    // FIXME: Use this for trimming only the whole parts of the video, not separating the fade portions into their own trims
    /*
    let videoLeft = videoList[0];
    for (let i = 1; i < videoList.length; i++) {
        const videoRight = videoList[i];
        const fileDest = `/home/jbud/Desktop/deleteme/file_tmp_merged${i}.mp4`;

        let mergeResult = await mergeVideos(videoLeft.fileSrc, videoRight.fileSrc, fileDest, inputVideoDetails.encoder, videoLeft.fadeOffset, videoLeft.fadeDuration, pixelFormat);
        if (!mergeResult) {
            throw new Error("Error merging video");
            process.exit(-1);
        }

        videoLeft = {
            fileSrc: fileDest,
            duration: videoRight.duration,
            fadeOffset: videoRight.fadeOffset
        };
    }
    */


    // FIXME: each timeToKeep gets 2-3 trims: left fade(?), middle non-faded, right fade(?)
    //  The faded parts are merged together; then all parts are concatenated in the end
    let videosToConcat = [];
    let videoLeft = null;
    for (let i = 0; i < videoList.length; i++) {
        const video = videoList[i];
        let doFade = false;
        if (video.needsFade) {
            if (videoLeft == null) {
                videoLeft = video;
                continue;
            }

            // merge videoLeft with video
            doFade = true;
        } else {
            assert(videoLeft == null, "Error: videoLeft is not null"); // previous video was expecting to be merged with this video
        }

        if (doFade) {
            const fadeOffset = fadeDuration; // FIXME: correct?
            const fileDest = `/home/jbud/Desktop/deleteme/file_tmp_merged${i}.mp4`;
            console.log(`Merging video ${videoLeft.fileSrc} and ${video.fileSrc} to ${fileDest}`);
            let mergeResult = await mergeVideos(videoLeft.fileSrc, video.fileSrc, fileDest, inputVideoDetails.encoder, fadeOffset, fadeDuration, pixelFormat);
            assert(mergeResult, "Error merging video");

            videosToConcat.push({
                fileSrc: fileDest,
                duration: videoLeft.duration + video.duration, // FIXME: correct?
                srcStart: videoLeft.srcStart,
                srcEnd: video.srcEnd
            });
            videoLeft = null;
        } else {
            videosToConcat.push({
                fileSrc: video.fileSrc,
                duration: video.duration,
                srcStart: video.srcStart,
                srcEnd: video.srcEnd
            });
        }
    }




    let concatVideo = async (videos) => {

        return new Promise((resolve, reject) => {



            let totalDuration = 0;
            const fileConcatList = '/home/jbud/Desktop/deleteme/file_tmp_concat.txt';
            fs.writeFileSync(fileConcatList, 'ffconcat version 1.0\n', { encoding: "utf8", flag: "w", mode: 0o666 });
            for (let i = 0; i < videos.length; i++) {
                const video = videos[i];
                const filename = path.basename(video.fileSrc); // FIXME: ffmpeg doesn't allow paths in the concat file
                fs.writeFileSync(fileConcatList, "file " + filename + "\n", { encoding: "utf8", flag: "a+", mode: 0o666 });
                //command.input(video.fileSrc);

                const totalDurationStr = secondsToTimestamp(totalDuration),
                        srcStartStr = secondsToTimestamp(video.srcStart),
                        srcEndStr = secondsToTimestamp(video.srcEnd);
                console.log(`Adding video ${filename}: ${totalDurationStr}    (original: ${srcStartStr} -> ${srcEndStr})`);
                totalDuration += video.duration;
            }

            const totalDurationStr = secondsToTimestamp(totalDuration);
            console.log(`Total duration: ${totalDurationStr}`);

            let command = ffmpeg(fileConcatList);
            command
                .inputOptions(['-f concat', '-safe 0'])
                .inputFormat('concat')
                //.outputOptions(['-c copy'])
                .videoCodec('copy')
                .on('end', () => {
                    console.log('File has been concatenated successfully.');
                    resolve(true);
                })
                .on('error', (err) => {
                    console.error('An error occurred: ' + err.message);
                    resolve(false);
                })
                .on('progress', function(progress) {
                    //console.log('Processing: ' + progress.percent + '% done');
                })
                .on('stderr', function(stderrLine) {
                    //console.log('Stderr output: ' + stderrLine);
                })
                .on('stdout', function(stdoutLine) {
                    console.log('stdout output: ' + stdoutLine);
                })
                //.mergeToFile('joutput.mp4', '/home/jbud/Desktop/deleteme/');
                //.run();
                .save(output);
        });
    };

    await concatVideo(videosToConcat);


    // Now compare the input/output to make sure we haven't lost any (unintentional) quality
    let outputVideoDetails = await getVideoDetails(output);
    const videoDifferencesToCheck = [
        // Codec
        { key: "codec_name", name: "Codec" },
        { key: "codec_long_name", name: "Codec Long Name" },
        { key: "level", name: "Codec Level" }, // unsure what this is
        { key: "refs", name: "Codec Refs" }, // unsure what this is
        { key: "profile", name: "Codec Profile" },

        // Resolution
        { key: "width", name: "Resolution" }, // displayed resolution
        { key: "height", name: "Resolution" },
        { key: "coded_width", name: "Resolution" }, // encoded resolution, not the displayed resolution (eg. padded pixels for encoding purposes)
        { key: "coded_height", name: "Resolution" },

        // Pixel Format, Colour Depth, Chroma Subsampling
        { key: "pix_fmt", name: "Pixel Format" },
        { key: "bits_per_raw_sample", name: "Colour Depth" },
        { key: "chroma_location", name: "Chroma" },

        // Dynamic Range (SDR/HDR)
        { key: "color_range", name: "Colour Range" },
        { key: "color_space", name: "Colour Space" },
        { key: "color_transfer", name: "Colour Transfer" },
        { key: "color_primaries", name: "Colour Primaries" },

        // Frame Rate
        { key: "r_frame_rate", name: "Frame Rate" },
        { key: "avg_frame_rate", name: "Frame Rate" },

        // Aspect Ratio
        { key: "display_aspect_ratio", name: "Aspect Ratio" },
        { key: "sample_aspect_ratio", name: "Aspect Ratio" },

        // Bitrate (this always seems off)
        { key: "bit_rate", name: "Bitrate (expected)" },
    ];
    const audioDifferencesToCheck = [
        // Codec
        { key: "codec_name", name: "Codec" },
        { key: "codec_long_name", name: "Codec Long Name" },

        // Samples
        { key: "sample_fmt", name: "Sample Format" },
        { key: "sample_rate", name: "Sample Rate" },

        // Channels
        { key: "channels", name: "Channels" },
        { key: "channel_layout", name: "Channel Layout" },

        // Bitrate (this always seems off)
        { key: "bit_rate", name: "Bitrate (expected)" },
    ];

    let totalDifferences = 0;
    for (let i = 0; i < videoDifferencesToCheck.length; ++i) {
        const difference = videoDifferencesToCheck[i];
        if (outputVideoDetails.video[difference.key] != inputVideoDetails.video[difference.key]) {
            console.error(`Video difference: ${difference.name} - input: ${inputVideoDetails.video[difference.key]} - output: ${outputVideoDetails.video[difference.key]}`);
            ++totalDifferences;
        }
    }
    
    if (totalDifferences === 0) {
        console.log("Video details match");
    }

    totalDifferences = 0;
    for (let i = 0; i < audioDifferencesToCheck.length; ++i) {
        const difference = audioDifferencesToCheck[i];
        if (outputVideoDetails.audio[difference.key] != inputVideoDetails.audio[difference.key]) {
            console.error(`Audio difference: ${difference.name} - input: ${inputVideoDetails.audio[difference.key]} - output: ${outputVideoDetails.audio[difference.key]}`);
        }
    }
    
    if (totalDifferences === 0) {
        console.log("Audio details match");
    }





    console.log("SUCCESS");
    process.exit(1);








    let complexFilterList = [];


    /*  FIXME: Use this to trim in complexFilter
    // build trim filter graph

    // this is list of times to keep
    const trimList = timesToKeep;


    let prevFadeOffset = 0;
    for (let i = 0; i < trimList.length; ++i) {
        const toTrim = trimList[i],
        trimVideoInput = '0:v',
        trimAudioInput = '0:a',
        trimVideoOutput = 'vi' + i,
        trimAudioOutput = 'ai' + i;

        complexFilterList.push({
            filter: 'trim',
            options: {
                start: toTrim.start,
                end: toTrim.end
            },
            inputs: trimVideoInput,
            outputs: trimVideoOutput
        });
        complexFilterList.push({
            filter: 'atrim',
            options: {
                start: toTrim.start,
                end: toTrim.end
            },
            inputs: trimAudioInput,
            outputs: trimAudioOutput
        });
    
        videoDetails = {
            videoInput: trimVideoInput,
            audioInput: trimAudioInput,
            videoOutput: trimVideoOutput,
            audioOutput: trimAudioOutput,
            duration: (toTrim.end - toTrim.start),
            fadeDuration: fadeDuration,
            fadeOffset: null
        };
        videoDetails.fadeOffset = prevFadeOffset + videoDetails.duration - fadeDuration;
        prevFadeOffset = videoDetails.fadeOffset;
        videoList.push(videoDetails);
    }
    */


    // FIXME: Use this to run all fades in complexFilter
    /*
    // build xfade filter graph
    let leftStreamV = videoList[0].videoOutput;// '0:v';
    let leftStreamA = videoList[0].audioOutput;// '0:a';
    let outStreamV = null;
    let outStreamA = null;
    for (let i = 0; i < (videoList.length - 1); i++) {
        const video = videoList[i];

        // video filter
        outStreamV = 'V' + (i + 1);
        let rightStreamV = videoList[i + 1].videoOutput;// (i + 1) + ':v';
        const videoFilter = {
            filter: 'xfade',
            options: {
                transition: 'fadeblack',
                duration: video.fadeDuration,
                offset: video.fadeOffset
            },
            inputs: [leftStreamV, rightStreamV],
            outputs: outStreamV
        };
        leftStreamV = outStreamV;
        complexFilterList.push(videoFilter);

        // audio filter
        outStreamA = 'A' + (i + 1);
        let rightStreamA = videoList[i + 1].audioOutput;// (i + 1) + ':a';
        const audioFilter = {
            filter: 'acrossfade',
            options: {
                d: video.fadeDuration
            },
            inputs: [leftStreamA, rightStreamA],
            outputs: outStreamA
        };
        leftStreamA = outStreamA;
        complexFilterList.push(audioFilter);
    }
    */



    command = ffmpeg();
    //command.input(file);

    for (let i = 0; i < videoList.length; i++) {
        const video = videoList[i];
        command.input(video.fileSrc);
    }

    //command.input(concatLeft);
    //command.input(concatRight);
    //command.input(concatRight);
    //const filterComplex = `[0:v][1:v]xfade=transition=fade:duration=${fadeDuration}:offset=${fadeOffset}[V];[0:a][1:a]acrossfade=d=${fadeDuration}[A]`;
    //command.complexFilter(filterComplex, ['V', 'A'])
    command.complexFilter(
        complexFilterList
        /*
        [

        // [1] + [2]
        {
            filter: 'xfade',
            options: {
                transition: 'fadeblack',
                duration: fadeDuration,
                offset: fadeOffset
            },
            inputs: ['0:v', '1:v'],
            outputs: 'V1'
        },
        {
            filter: 'acrossfade',
            options: {
                d: fadeDuration
            },
            inputs: ['0:a', '1:a'],
            outputs: 'A1'
        },

        // [1,2] + [3]
        {
            filter: 'xfade',
            options: {
                transition: 'fadeblack',
                duration: fadeDuration,
                offset: 19
            },
            inputs: ['V1', '2:v'],
            outputs: 'V2'
        },
        {
            filter: 'acrossfade',
            options: {
                d: fadeDuration
            },
            inputs: ['A1', '2:a'],
            outputs: 'A2'
        }
        ]
        */
        )
        .outputOptions(["-map ["+ outStreamV +"]", "-pix_fmt " + pixelFormat, "-map ["+ outStreamA +"]"])//, "-map [A]", "-v verbose"])
        .videoCodec(inputVideoDetails.encoder)
        //.audioCodec('copy')
        .on('end', () => {
        console.log('File has been concatenated successfully.');
        })
        .on('error', (err) => {
        console.error('An error occurred: ' + err.message);
        })
        .on('progress', function(progress) {
            console.log('Processing: ' + progress.percent + '% done');
        })
        .on('stderr', function(stderrLine) {
            console.log('Stderr output: ' + stderrLine);
        })
        .on('stdout', function(stdoutLine) {
            console.log('stdout output: ' + stdoutLine);
        })
        .save(output); // NOTE: save is just output + run

};
main();
