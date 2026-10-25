# tools — Windows 打包辅助

## launcher.c

顶层 `NCL.exe` 启动器的源码。Electron 运行时文件必须与主程序同目录，
为了让顶层只保留一个 exe，真正干活的 `electron.exe` 及全部运行时文件放在
`engine/` 子目录，由这个 52KB 的启动器负责拉起。

编译（需 MinGW-w64）：

```bash
x86_64-w64-mingw32-windres resource.rc -o resource.o   # 图标资源
x86_64-w64-mingw32-gcc -mwindows -municode -O2 -s launcher.c resource.o -o NCL.exe
```

## 应用图标

`assets/icon.png`（1024×1024）由草方块底图与 NCL 像素字标合成，
同时用于：BrowserWindow 图标（`main/main.js` 引用）、启动器 exe 图标（转 .ico）。
