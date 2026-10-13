!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!define LOCAL_MODEL_SPACE_3B_KB 5242880
!define LOCAL_MODEL_SPACE_7B_KB 8388608
!define LOCAL_MODEL_SPACE_14B_KB 14680064

!ifndef BUILD_UNINSTALLER
Var GeminiKeyInput
Var InstallerGeminiKey
Var Model3BInput
Var Model7BInput
Var Model14BInput
Var InstallerOllamaModel

!macro customInit
  SectionGetSize 0 $0
  IntOp $0 $0 + ${LOCAL_MODEL_SPACE_3B_KB}
  SectionSetSize 0 $0
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_HEADER_TEXT "AI settings"
  !define MUI_PAGE_HEADER_SUBTEXT "Choose the models Desktop Pet will use."
  Page custom DesktopPetSettingsPage DesktopPetSettingsLeave
  !undef MUI_PAGE_HEADER_TEXT
  !undef MUI_PAGE_HEADER_SUBTEXT
!macroend

!macro customInstall
  SetDetailsView show
  DetailPrint "Installing Ollama and downloading $InstallerOllamaModel..."
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i ("DESKTOP_PET_INSTALL_OLLAMA_MODEL", "$InstallerOllamaModel").r0'
  nsExec::ExecToLog /TIMEOUT=2700000 '"$appExe" --installer-setup'
  Pop $0
  DetailPrint "AI setup process result: $0"
  System::Call 'Kernel32::SetEnvironmentVariable(t, t) i ("DESKTOP_PET_INSTALL_OLLAMA_MODEL", "").r1'
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "AI setup failed. Review the installer details for more information."
    Abort
  ${EndIf}
  WriteRegStr HKCU "Software\DesktopPet" "OllamaModel" "$InstallerOllamaModel"
!macroend

Function DesktopPetSettingsPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Gemini API key (optional). Encrypted for this Windows account after launch. Leave blank to use Ollama."
  Pop $0
  ${NSD_CreatePassword} 0 26u 100% 14u ""
  Pop $GeminiKeyInput

  ${NSD_CreateLabel} 0 44u 100% 14u "Choose a local model:"
  Pop $0
  ${NSD_CreateRadioButton} 0 60u 100% 12u "Qwen2.5 3B - lite / laptop recommended"
  Pop $Model3BInput
  ${NSD_CreateRadioButton} 0 74u 100% 12u "Qwen2.5 7B - balanced / Desktop recommended"
  Pop $Model7BInput
  ${NSD_CreateRadioButton} 0 88u 100% 12u "Qwen2.5 14B - heavy / high-end computers recommended"
  Pop $Model14BInput
  ${NSD_Check} $Model3BInput

  ${NSD_CreateLabel} 0 104u 100% 128u "3B: 8 GB RAM, 4-core CPU, ~5 GB free disk.$\r$\n7B: 16 GB RAM, 6-core CPU, ~8 GB disk. 8 GB VRAM GPU recommended.$\r$\n14B: 32 GB RAM, 8-core CPU, ~14 GB disk. 12 GB VRAM GPU recommended.$\r$\nAll: 64-bit Windows 10 22H2/11;"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function DesktopPetSettingsLeave
  ${NSD_GetText} $GeminiKeyInput $InstallerGeminiKey
  ${NSD_GetState} $Model7BInput $0
  ${If} $0 == 1
    StrCpy $InstallerOllamaModel "qwen2.5:7b"
    SectionGetSize 0 $1
    IntOp $1 $1 - ${LOCAL_MODEL_SPACE_3B_KB}
    IntOp $1 $1 + ${LOCAL_MODEL_SPACE_7B_KB}
    SectionSetSize 0 $1
    Return
  ${EndIf}
  ${NSD_GetState} $Model14BInput $0
  ${If} $0 == 1
    StrCpy $InstallerOllamaModel "qwen2.5:14b"
    SectionGetSize 0 $1
    IntOp $1 $1 - ${LOCAL_MODEL_SPACE_3B_KB}
    IntOp $1 $1 + ${LOCAL_MODEL_SPACE_14B_KB}
    SectionSetSize 0 $1
  ${Else}
    StrCpy $InstallerOllamaModel "qwen2.5:3b"
  ${EndIf}
FunctionEnd

!macro customFinishPage
  Function StartDesktopPetWithInstallerSettings
    System::Call 'Kernel32::SetEnvironmentVariable(t, t) i ("DESKTOP_PET_INSTALL_GEMINI_KEY", "$InstallerGeminiKey").r0'
    Exec '"$appExe"'
    System::Call 'Kernel32::SetEnvironmentVariable(t, t) i ("DESKTOP_PET_INSTALL_GEMINI_KEY", "").r0'
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE StartDesktopPetWithInstallerSettings
  !insertmacro MUI_PAGE_FINISH
!macroend
!endif

!ifdef BUILD_UNINSTALLER
Var RemoveOllama
Var InstalledOllamaModel

!macro customUnInit
  Call un.AskRemoveOllama
!macroend

!macro customUnInstall
  ${If} $RemoveOllama == "1"
    Call un.RemoveOllama
  ${EndIf}
  DeleteRegValue HKCU "Software\DesktopPet" "OllamaModel"
!macroend

Function un.AskRemoveOllama
  StrCpy $RemoveOllama "0"
  ReadRegStr $InstalledOllamaModel HKCU "Software\DesktopPet" "OllamaModel"
  StrCmp $InstalledOllamaModel "qwen2.5:7b" modelKnown
  StrCmp $InstalledOllamaModel "qwen2.5:14b" modelKnown
  StrCpy $InstalledOllamaModel "qwen2.5:3b"
  modelKnown:
  IfSilent done
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also uninstall Ollama and remove the $InstalledOllamaModel model? Other Ollama models will be kept." IDYES removeOllama IDNO done
  removeOllama:
    StrCpy $RemoveOllama "1"
  done:
FunctionEnd

Function un.RemoveOllama
  StrCpy $0 "$LOCALAPPDATA\Programs\Ollama"
  IfFileExists "$0\ollama.exe" ollamaFound

  StrCpy $0 "$PROGRAMFILES64\Ollama"
  IfFileExists "$0\ollama.exe" ollamaFound

  StrCpy $0 "$PROGRAMFILES\Ollama"
  IfFileExists "$0\ollama.exe" ollamaFound

  MessageBox MB_ICONEXCLAMATION|MB_OK "Ollama could not be found in its standard installation folders. Desktop Pet was removed, but Ollama and its model were left in place."
  Return

  ollamaFound:
    DetailPrint "Removing the $InstalledOllamaModel model..."
    nsExec::ExecToLog '"$0\ollama.exe" rm $InstalledOllamaModel'
    Pop $1
    ${If} $1 != 0
        MessageBox MB_ICONEXCLAMATION|MB_OK "The $InstalledOllamaModel model could not be removed. Ollama will still be uninstalled."
    ${EndIf}

    IfFileExists "$0\unins000.exe" uninstallOllama
    MessageBox MB_ICONEXCLAMATION|MB_OK "The Ollama uninstaller could not be found. The $InstalledOllamaModel model cleanup was attempted, but Ollama may remain installed."
    Return

  uninstallOllama:
    DetailPrint "Uninstalling Ollama..."
    ExecWait '"$0\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART' $1
    DeleteRegValue HKCU "Software\DesktopPet" "OllamaModel"
    ${If} $1 != 0
      MessageBox MB_ICONEXCLAMATION|MB_OK "Ollama could not be fully uninstalled. Run its uninstaller manually if needed."
    ${EndIf}
FunctionEnd
!endif