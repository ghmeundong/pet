!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!define LOCAL_MODEL_SPACE_KB 5242880

!ifndef BUILD_UNINSTALLER
Var GeminiKeyInput
Var InstallerGeminiKey

!macro customInit
  SectionGetSize 0 $0
  IntOp $0 $0 + ${LOCAL_MODEL_SPACE_KB}
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
  DetailPrint "Installing Ollama and downloading Qwen2.5 3B..."
  nsExec::ExecToLog /TIMEOUT=2700000 '"$appExe" --installer-setup'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "AI setup failed. Review the installer details for more information."
    Abort
  ${EndIf}
!macroend

Function DesktopPetSettingsPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "Gemini API key (optional). It is encrypted for this Windows account after launch. Leave blank to use Ollama and its local model."
  Pop $0
  ${NSD_CreatePassword} 0 32u 100% 14u ""
  Pop $GeminiKeyInput

  ${NSD_CreateLabel} 0 62u 100% 64u "During installation, Desktop Pet installs Ollama and downloads the Qwen2.5 3B model. Internet is required. Allow about 5 GB for Ollama and Qwen in addition to the app files. Qwen is licensed for non-commercial use; the license is included with this installer."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function DesktopPetSettingsLeave
  ${NSD_GetText} $GeminiKeyInput $InstallerGeminiKey
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

!macro customUnInit
  Call un.AskRemoveOllama
!macroend

!macro customUnInstall
  ${If} $RemoveOllama == "1"
    Call un.RemoveOllama
  ${EndIf}
!macroend

Function un.AskRemoveOllama
  StrCpy $RemoveOllama "0"
  IfSilent done
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also uninstall Ollama and remove the Qwen2.5 3B model? Other Ollama models will be kept." IDYES removeOllama IDNO done
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
    DetailPrint "Removing the Qwen2.5 3B model..."
    nsExec::ExecToLog '"$0\ollama.exe" rm qwen2.5:3b'
    Pop $1
    ${If} $1 != 0
      MessageBox MB_ICONEXCLAMATION|MB_OK "The Qwen2.5 3B model could not be removed. Ollama will still be uninstalled."
    ${EndIf}

    IfFileExists "$0\unins000.exe" uninstallOllama
    MessageBox MB_ICONEXCLAMATION|MB_OK "The Ollama uninstaller could not be found. The Qwen2.5 3B model cleanup was attempted, but Ollama may remain installed."
    Return

  uninstallOllama:
    DetailPrint "Uninstalling Ollama..."
    ExecWait '"$0\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART' $1
    ${If} $1 != 0
      MessageBox MB_ICONEXCLAMATION|MB_OK "Ollama could not be fully uninstalled. Run its uninstaller manually if needed."
    ${EndIf}
FunctionEnd
!endif