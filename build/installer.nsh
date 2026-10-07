!include "LogicLib.nsh"
!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var GeminiKeyInput
Var InstallerGeminiKey

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

  ${NSD_CreateLabel} 0 62u 100% 64u "During installation, Desktop Pet installs Ollama and downloads the Qwen2.5 3B model. Internet is required. Allow about 5 GB of free disk space. Qwen is licensed for non-commercial use; the license is included with this installer."
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