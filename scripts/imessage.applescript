-- usage: osascript imessage.applescript <phone-or-apple-id> <message>
on run argv
	tell application "Messages"
		set svc to 1st account whose service type = iMessage
		send (item 2 of argv) to participant (item 1 of argv) of svc
	end tell
end run
