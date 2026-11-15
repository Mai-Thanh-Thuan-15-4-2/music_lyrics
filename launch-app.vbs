Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir

' 1. Nếu có Electron local thì chạy trực tiếp Electron (main.js tự bật server.js bên trong)
electronExe = appDir & "\node_modules\electron\dist\electron.exe"
If fso.FileExists(electronExe) Then
  shell.Run """" & electronExe & """ """ & appDir & """", 1, False
  WScript.Quit
End If

' 2. Tự động khởi động ngầm server.js (YouTube Audio Bridge + Cache + Workspace)
shell.Run "cmd /c node """ & appDir & "\server.js""", 0, False
WScript.Sleep 650

' 3. Mở cửa sổ App độc lập với chế độ Dark Titlebar & Dark UI
appUrl = "http://127.0.0.1:3456"
profileDir = appDir & "\.studio_cache\app_profile"
flags = " --app=" & appUrl & " --window-size=1460,920 --force-dark-mode --enable-features=WebUIDarkMode,WebContentsForceDark:inversion_method/none --user-data-dir=""" & profileDir & """"

edgePath1 = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
edgePath2 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
chromePath1 = "C:\Program Files\Google\Chrome\Application\chrome.exe"
chromePath2 = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

If fso.FileExists(edgePath1) Then
  shell.Run """" & edgePath1 & """" & flags, 1, False
ElseIf fso.FileExists(edgePath2) Then
  shell.Run """" & edgePath2 & """" & flags, 1, False
ElseIf fso.FileExists(chromePath1) Then
  shell.Run """" & chromePath1 & """" & flags, 1, False
ElseIf fso.FileExists(chromePath2) Then
  shell.Run """" & chromePath2 & """" & flags, 1, False
Else
  shell.Run appUrl, 1, False
End If
