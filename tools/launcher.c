/* NCL.exe — Nexus Craft Launcher 启动器（MinGW 编译，无控制台窗口）
 * 职责：找到同目录下的 engine\NCL.exe 并启动它。
 * 真正的 Electron 运行时与应用代码全部在 engine\ 文件夹内，
 * 顶层只保留这一个 NCL.exe，界面清爽。 */
#include <windows.h>
#include <strsafe.h>

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, PWSTR cmdLine, int nShow) {
    wchar_t exeDir[MAX_PATH], engineDir[MAX_PATH], target[MAX_PATH], newCmd[MAX_PATH * 2 + 16];

    /* 定位自身所在目录 */
    GetModuleFileNameW(NULL, exeDir, MAX_PATH);
    wchar_t *slash = wcsrchr(exeDir, L'\\');
    if (slash) *(slash + 1) = L'\0';
    StringCchPrintfW(engineDir, MAX_PATH, L"%sengine", exeDir);
    StringCchPrintfW(target, MAX_PATH, L"%s\\NCL.exe", engineDir);

    if (GetFileAttributesW(target) == INVALID_FILE_ATTRIBUTES) {
        MessageBoxW(NULL,
            L"未找到 engine\\NCL.exe。\n\n"
            L"请保持 NCL.exe 与 engine 文件夹处于同一目录，\n"
            L"不要把 NCL.exe 单独移走。",
            L"NCL — Nexus Craft Launcher", MB_OK | MB_ICONERROR);
        return 1;
    }

    /* 透传命令行参数（跳过启动器自身的 argv[0]） */
    LPWSTR cl = GetCommandLineW();
    BOOL inQuote = FALSE;
    while (*cl) {
        if (*cl == L'"') inQuote = !inQuote;
        else if (*cl == L' ' && !inQuote) break;
        cl++;
    }
    while (*cl == L' ') cl++;
    StringCchPrintfW(newCmd, MAX_PATH * 2 + 16, L"\"%s\" %s", target, cl);

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    ZeroMemory(&pi, sizeof(pi));
    si.cb = sizeof(si);
    /* 工作目录设为 engine，保证 Chromium 相对路径解析正确 */
    if (!CreateProcessW(target, newCmd, NULL, NULL, FALSE, 0, NULL, engineDir, &si, &pi)) {
        MessageBoxW(NULL, L"启动失败：无法创建 Electron 进程。", L"NCL — Nexus Craft Launcher", MB_OK | MB_ICONERROR);
        return 2;
    }
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return 0;
}
