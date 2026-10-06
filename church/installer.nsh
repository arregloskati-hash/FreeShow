; FreeShow Church: install to its own folder, so it never overwrites the official FreeShow
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\FreeShow Church"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\FreeShow Church"
!macroend
