' Starts the dot.home keeper (run.ps1) without a console window. Used by the "dot.home" scheduled task.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\run.ps1""", 0, False
