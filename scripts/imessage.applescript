-- usage: osascript imessage.applescript <phone-or-apple-id> <video-path> <message>
on run argv
	set toWho to item 1 of argv
	set vid to POSIX file (item 2 of argv)
	set msg to item 3 of argv
	tell application "Messages"
		set svc to 1st account whose service type = iMessage
		set buddyRef to participant toWho of svc
		send msg to buddyRef
		send vid to buddyRef
	end tell
end run
