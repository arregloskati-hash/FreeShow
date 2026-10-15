; FreeShow Church: install to its own folder, so it never overwrites the official FreeShow
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\FreeShow Church"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\FreeShow Church"
!macroend

; FreeShow Church: event installers carry the fonts their slides use (resources\event\fonts).
; They are installed for the current user (no admin needed, Windows 10 1809+), so FreeShow can use them right away.
!macro customInstall
  IfFileExists "$INSTDIR\resources\event\fonts\*.*" 0 churchNoEventFonts
    CreateDirectory "$LOCALAPPDATA\Microsoft\Windows\Fonts"
    FindFirst $0 $1 "$INSTDIR\resources\event\fonts\*.*"
    churchFontLoop:
      StrCmp $1 "" churchFontsDone
      StrCmp $1 "." churchFontNext
      StrCmp $1 ".." churchFontNext
      CopyFiles /SILENT "$INSTDIR\resources\event\fonts\$1" "$LOCALAPPDATA\Microsoft\Windows\Fonts\$1"
      WriteRegStr HKCU "Software\Microsoft\Windows NT\CurrentVersion\Fonts" "$1 (FreeShow Church)" "$LOCALAPPDATA\Microsoft\Windows\Fonts\$1"
      System::Call 'gdi32::AddFontResource(t "$LOCALAPPDATA\Microsoft\Windows\Fonts\$1") i .r2'
    churchFontNext:
      FindNext $0 $1
      Goto churchFontLoop
    churchFontsDone:
    FindClose $0
    SendMessage 0xFFFF 0x001D 0 0 /TIMEOUT=1000
  churchNoEventFonts:
!macroend
