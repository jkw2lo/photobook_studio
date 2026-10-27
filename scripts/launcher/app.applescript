-- Photobook Studio launcher. Generated into an app by scripts/make-launcher.sh.
-- A stay-open app: starting it starts the local server and opens the editor; clicking the Dock
-- icon reopens the editor; quitting it stops the server.
property projectDir : "__PROJECT__"
property envPrefix : "__ENV__"
property editorURL : ""
property openBrowser : __OPEN__

on run
	startServer()
end run

on startServer()
	try
		set editorURL to do shell script envPrefix & quoted form of (projectDir & "/scripts/launcher/start.sh")
		if openBrowser then open location editorURL
	on error errMsg
		display dialog "Photobook Studio couldn’t start." & return & return & errMsg buttons {"Quit"} default button 1 with icon stop with title "Photobook Studio"
		quit
	end try
end startServer

on reopen
	if editorURL is not "" then open location editorURL
end reopen

on idle
	if editorURL is not "" then
		-- The server can be away for a while when it restarts itself onto new code (the editor's
		-- "Restart server now" rebuilds first): only ask once it has been gone for about a minute.
		set alive to false
		repeat 20 times
			try
				do shell script "/usr/bin/curl -sf -m 3 -o /dev/null " & quoted form of (editorURL & "/api/health")
				set alive to true
				exit repeat
			on error
				delay 3
			end try
		end repeat
		if not alive then
			set choice to button returned of (display dialog "The Photobook Studio server stopped." buttons {"Quit", "Restart"} default button "Restart" with title "Photobook Studio")
			if choice is "Restart" then
				startServer()
			else
				quit
			end if
		end if
	end if
	return 15
end idle

on quit
	try
		do shell script envPrefix & quoted form of (projectDir & "/scripts/launcher/stop.sh")
	end try
	continue quit
end quit
