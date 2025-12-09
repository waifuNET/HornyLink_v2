!ifndef OUTPUT_DIR
  !define OUTPUT_DIR "."
!endif

!ifndef APP_DIR
  !define APP_DIR "build\HornyLink-win32-x64"
!endif

OutFile "${OUTPUT_DIR}\HornyLink_Setup.exe"

InstallDir "$LOCALAPPDATA\HornyLink" ; ✅ безопасная директория без прав админа

RequestExecutionLevel user ; ✅ НЕ требует UAC

Icon "icon.ico"
Name "HornyLink"
Caption "Установка HornyLink"
BrandingText "WaifNET Inc."

Page directory
Page instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*.*"

  ; Создание ярлыков
  CreateShortcut "$DESKTOP\HornyLink.lnk" "$INSTDIR\HornyLink.exe"
  CreateDirectory "$SMPROGRAMS\HornyLink"
  CreateShortcut "$SMPROGRAMS\HornyLink\HornyLink.lnk" "$INSTDIR\HornyLink.exe"

  ; Удалить строку регистрации в HKLM, т.к. это требует прав админа
  ; Вместо этого можно использовать HKCU (для текущего пользователя)
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HornyLink" "DisplayName" "HornyLink"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HornyLink" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HornyLink" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HornyLink" "Publisher" "WaifNET Inc."
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HornyLink" "DisplayVersion" "1.0.0"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HornyLink" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HornyLink" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$DESKTOP\HornyLink.lnk"
  Delete "$SMPROGRAMS\HornyLink\HornyLink.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HornyLink"
  RMDir "$SMPROGRAMS\HornyLink"
SectionEnd
