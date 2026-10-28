-- usage: osascript imessage.applescript <phone-or-apple-id> <message> [video-path]
-- Videos are staged in ~/Pictures first; Messages delivers attachments from there reliably.
on run argv
	set toWho to item 1 of argv
	set msg to item 2 of argv
	tell application "Messages"
		set svc to 1st account whose service type = iMessage
		set buddyRef to participant toWho of svc
		send msg to buddyRef
	end tell
	if (count of argv) > 2 then
		set srcPath to item 3 of argv
		set stageDir to (POSIX path of (path to pictures folder)) & "Reel Engine/"
		do shell script "mkdir -p " & quoted form of stageDir & " && cp " & quoted form of srcPath & " " & quoted form of stageDir
		set staged to stageDir & (do shell script "basename " & quoted form of srcPath)
		tell application "Messages" to send (POSIX file staged) as alias to participant toWho of (1st account whose service type = iMessage)
	end if
end run
