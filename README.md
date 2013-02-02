# JB's utility scripts


Screenshot
=================

simple screenshot utility. usage:
```````````````````````
	./screenshot -w # windowed mode (screenshots currently activated window)
	./screenshot -m burst # take screenshots repeatedly until stopped
```````````````````````

Burst mode explained:
	when activated, screenshots will be repeatedly taken with 2-second intervals
	(interval settings defined within script), until another instance of screenshot
	is run with burst mode. All burst screenshots are stored within a folder
	specifically within that burst instance

Screenrec
=================

screen recording utility. usage:
`````````````````````````
	./screenrec -m start
	./screenrec -m pause
	./screenrec -m resume
	./screenrec -m stop

	# -p [preset]   presets found in /usr/share/avconv
	# -r [framerate]
	# -m pause		pausing twice will stop the script
	# -w 			region-select (record a selected region)
`````````````````````````

Backup explained:
	recordings are automatically recorded in chunks (60 second chunks), in case
	anything happens (computer crashes, etc.) then you still have those individual
	recordings

Snapshot
=================

takes a snapshot of a current directory (and every file within it). I find this 
useful to keep track of all movies, tv shows, music I have in the off chance that
my external hard drive fails and I need to retrieve everything again from scratch

I personally use this with a cron script weekly (see installation below)

Errors
=================

In the case that screenshots or screenrecordings are being done and you cannot stop
them, you can stop it manually like so,
`````````````````````````
	# screenshot
	ps aux | grep screenshot
	kill -9 [process id]

	# screenrec
	ps aux | grep avconv
	kill -9 [process id]
	ps aux | grep screenrec
	kill -9 [process id]
``````````````````````````


INSTALL
=================

obviously these are best set as hotkeys, so here's my setup
(Ubuntu 12.04 users: Settings -> Keyboard -> Shortcuts -> Custom)
(Gnome manual hotkeys: gconf-editor  desktop/gnome/keybindings)
	
````````````````````````
	JB's Screenshot (windowed)		  :: /home/jbud/utilities/screenshot -w
	JB's Screenshot (burst)			  :: /home/jbud/utilities/screenshot -m burst
	JB's Screenshot					  :: /home/jbud/utilities/screenshot
	JB's Screenrecord (start/resume)  :: /home/jbud/utilities/screenrec
	JB's Screenrecord (region select) :: /home/jbud/utilities/screenrec -w
	JB's Screenrecord (pause/stop)    :: /home/jbud/utilities/screenrec -m pause
````````````````````````

Required Libraries
  libnotify
  avconv (compiled with libx264)
  mkvtoolnix


Snapshot used on a weekly basis,
````````````````````````
	crontab -e  # added this to the bottom, to snapshot my movies dir
	0 14 * * 1 /home/jbud/utilities/snapshot_dir /media/LaCie_/FatDrive/Movies/ > /home/jbud/vault/snapshots/movies
````````````````````````


Donations
==============

Donations are always greatly appreciated. Feel free to Paypal me at Jbud@live.ca
..or not, that's cool too
