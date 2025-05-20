import { Symbol, ItemType } from "./symbol";
import { dirname } from "path";
import { Provider, ProviderType } from "./provider";
import { fileExists, semVer } from "./util";
import * as child from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

enum TerminalName {
  Testing = "Go Outliner: Test",
  Benchmark = "Go Outliner: Benchmarks",
  Channel = "Go Outliner: Debug",
}

export class Terminal {
  private _terminalTesting: vscode.Terminal | undefined;
  private _terminalBenchmarks: vscode.Terminal | undefined;
  private _terminalChannel: vscode.OutputChannel | undefined;
  private _disposable: vscode.Disposable[] = Array<vscode.Disposable>();
  private _enableDebugChannel: boolean = false;

  constructor() {
    this._enableDebugChannel = vscode.workspace
      .getConfiguration("goOutliner")
      .get("enableDebugChannel", false);
    vscode.workspace.onDidChangeConfiguration(
      () => {
        this._enableDebugChannel = vscode.workspace
          .getConfiguration("goOutliner")
          .get("enableDebugChannel", false);
        this.toggleChannel();
      },
      undefined,
      this._disposable
    );
    this.toggleChannel();

    vscode.window.onDidCloseTerminal(
      (x) => {
        switch (x.name) {
          case TerminalName.Testing:
            this._terminalTesting = undefined;
            break;
          case TerminalName.Benchmark:
            this._terminalBenchmarks = undefined;
            break;
        }
      },
      undefined,
      this._disposable
    );
  }

  private toggleChannel() {
    if (this._enableDebugChannel && !this._terminalChannel) {
      this._terminalChannel = vscode.window.createOutputChannel(
        TerminalName.Channel
      );
      return;
    }
    if (!this._enableDebugChannel && this._terminalChannel) {
      this.TerminalChannel.dispose();
    }
  }

  get TerminalChannel(): vscode.OutputChannel {
    if (this._terminalChannel) return this._terminalChannel;
    else throw new Error("Terminal channel is undefined.");
  }

  get TerminalTesting(): vscode.Terminal {
    if (!this._terminalTesting) {
      this._terminalTesting = vscode.window.createTerminal(
        TerminalName.Testing
      );
    }
    return this._terminalTesting;
  }

  get TerminalBenchmarks(): vscode.Terminal {
    if (!this._terminalBenchmarks) {
      this._terminalBenchmarks = vscode.window.createTerminal(
        TerminalName.Benchmark
      );
    }
    return this._terminalBenchmarks;
  }

  public TestFunc(name?: string) {
    const opt = name ? ` -run ^${name}$` : "";
    this.TerminalTesting.show();
    this.TerminalTesting.sendText(`go test${opt}`);
  }

  public BenchmarkFunc(name?: string) {
    const opt = name ? `^${name}$` : ".";
    this.TerminalBenchmarks.show();
    this.TerminalBenchmarks.sendText(`go test -bench ${opt}`);
  }

  public Channel(msg: string) {
    if (!this._enableDebugChannel) {
      return;
    }
    const ts: Date = new Date();
    this.TerminalChannel.appendLine(`${ts.toLocaleTimeString()}: ${msg}`);
  }

  public ChannelWithInformationMessage(msg: string) {
    vscode.window.showInformationMessage(msg);
    this.Channel(msg);
  }

  public dispose() {
    this._terminalTesting?.dispose();
    this._terminalBenchmarks?.dispose();
    if (this._terminalChannel) {
      this._terminalChannel.dispose();
    }

    for (let i = 0; i < this._disposable.length; i++) {
      this._disposable[i].dispose();
    }
  }
}

export class AppExec {
  private _onDidChangeMain: vscode.EventEmitter<Symbol[]> =
    new vscode.EventEmitter<Symbol[]>();
  readonly onDidChangeMain: vscode.Event<Symbol[]> =
    this._onDidChangeMain.event;
  private _onDidChangeTests: vscode.EventEmitter<Symbol[]> =
    new vscode.EventEmitter<Symbol[]>();
  readonly onDidChangeTests: vscode.Event<Symbol[]> =
    this._onDidChangeTests.event;
  private _onDidChangeBenchmarks: vscode.EventEmitter<Symbol[]> =
    new vscode.EventEmitter<Symbol[]>();
  readonly onDidChangeBenchmarks: vscode.Event<Symbol[]> =
    this._onDidChangeBenchmarks.event;

  public terminal: Terminal = new Terminal();
  public explorerExtension: vscode.Disposable | undefined = undefined;
  public symbols: Symbol[] = Array<Symbol>();

  private workspaceRoot: string = "";
  private binPathCache: Map<string, string> = new Map();

  constructor(ctx: vscode.ExtensionContext) {
    this.checkMissingTools();
    this.checkGoOutlinerVersion();

    // Get current active text editor and use it's file path as root
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      this.Reload(activeEditor.document.fileName);
    } else {
      this.Reload(vscode.workspace.rootPath);
    }

    // In the event of file save, reload again
    ctx.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(() => {
        this.terminal.Channel(`onDidSaveTextDocument: Event`);
        this.Reload();
      })
    );

    // Handle event when user opens a new file
    ctx.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        const e = vscode.window.activeTextEditor;
        if (!e) {
          return;
        }
        if (!fileExists(e.document.fileName)) {
          return;
        }
        this.terminal.Channel(
          `onDidChangeActiveTextEditor: Event; ${e.document.fileName}`
        );
        this.Reload(e.document.fileName);
      })
    );

    // Register Views
    const mainProvider = new Provider(ProviderType.Main, this.onDidChangeMain);

    // Extended Explorer View
    let extend = vscode.workspace
      .getConfiguration("goOutliner")
      .get("extendExplorerTab", false);
    this.terminal.Channel(
      `Extend default Explorer tab with outliner: ${extend}`
    );
    if (extend) {
      this.explorerExtension = vscode.window.registerTreeDataProvider(
        "outlinerExplorerExtensionView",
        mainProvider
      );
      vscode.commands.executeCommand(
        "setContext",
        `enableExplorerExtension`,
        extend
      );
    }

    vscode.workspace.onDidChangeConfiguration(
      () => {
        extend = vscode.workspace
          .getConfiguration("goOutliner")
          .get("extendExplorerTab", false);
        vscode.commands.executeCommand(
          "setContext",
          `enableExplorerExtension`,
          extend
        );

        if (extend && !this.explorerExtension) {
          this.explorerExtension = vscode.window.registerTreeDataProvider(
            "outlinerExplorerExtensionView",
            mainProvider
          );
        }
      },
      undefined,
      ctx.subscriptions
    );

    ctx.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        "outlinerExplorerView",
        mainProvider
      )
    );
    ctx.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        "outlinerTestsView",
        new Provider(ProviderType.Tests, this.onDidChangeTests)
      )
    );
    ctx.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        "outlinerBenchmarksView",
        new Provider(ProviderType.Benchmarks, this.onDidChangeBenchmarks)
      )
    );
  }

  public Reload(filePath?: string) {
    if (filePath) {
      let newWorkingDirectory: string = filePath;
      if (fileExists(filePath)) {
        newWorkingDirectory = dirname(filePath);
      }
      if (this.workspaceRoot !== newWorkingDirectory) {
        this.terminal.Channel(
          `Changing working directory from ${this.workspaceRoot} to ${newWorkingDirectory}`
        );
        this.workspaceRoot = newWorkingDirectory;
        this.symbols = Array<Symbol>();
        this.getOutlineForWorkspace();
      }
    } else {
      this.getOutlineForWorkspace();
    }
  }

  private getOutlineForWorkspace(): void {
    const bin = this.findToolFromPath("go-outliner");
    if (!bin) {
      return;
    }
    const dir = this.workspaceRoot;
    fs.readdir(dir, (err, files) => {
      if (err) {
        this.terminal.Channel(`Reading directory: ${dir}; Error: ${err};`);
        return;
      }
      for (let i = 0; i < files.length; i++) {
        if (files[i].toLowerCase().endsWith(".go")) {
          child.execFile(bin, [`${dir}`], {}, (err, stdout, stderr) => {
            if (err) {
              throw new Error(`${err}\n\nAdditional Info:\n${stderr}`);
            }

            this.symbols = JSON.parse(stdout).map(Symbol.fromObject);
            this.symbols.sort((a, b) => a.label.localeCompare(b.label));
            this.emitSymbols();
            this.terminal.Channel(
              `Reading directory: ${dir}; Results: ${this.symbols.length}`
            );
          });
          return;
        }
      }
      this.symbols = Array<Symbol>();
      this.emitSymbols();
      this.terminal.Channel(`Reading directory: ${dir}; Contains no Go files`);
    });
  }

  private emitSymbols() {
    this._onDidChangeMain.fire(this.symbols.filter((x) => !x.isTestFile));
    this._onDidChangeTests.fire(
      this.symbols.filter(
        (x) =>
          x.isTestFile && x.type === ItemType.Func && x.label.startsWith("Test")
      )
    );
    this._onDidChangeBenchmarks.fire(
      this.symbols.filter(
        (x) =>
          x.isTestFile &&
          x.type === ItemType.Func &&
          x.label.startsWith("Benchmark")
      )
    );
  }

  private checkMissingTools() {
    const tools: string[] = ["go-outliner"];
    tools.forEach((tool) => {
      const toolPath: string = this.findToolFromPath(tool);
      if (toolPath === "") {
        this.terminal.Channel(`Missing: ${tool}`);
        vscode.window
          .showInformationMessage(`Go Outliner: Missing: ${tool}`, "Install")
          .then((x) => {
            if (x === "Install") {
              this.installTool(tool);
            }
          });
      }
    });
  }

  private checkGoOutlinerVersion() {
    const bin = this.findToolFromPath("go-outliner");
    if (bin === "") {
      return;
    }
    const minVersion = "Version 0.3.0";
    child.execFile(bin, ["-version"], {}, (err, stdout, stderr) => {
      if (err || stderr) {
        this.terminal.Channel(`checkGoOutlinerVersion: ${err} ${stderr}`);
      }
      this.terminal.Channel(
        `Go-Outliner Version Check: Want (min): ${minVersion}; Have: ${stdout}`
      );
      if (semVer(stdout, minVersion) === -1) {
        vscode.window
          .showInformationMessage(
            `Go Outliner: Update go-outliner package?`,
            "Update"
          )
          .then((x) => {
            if (x === "Update") {
              this.installTool("go-outliner");
            }
          });
      }
    });
  }

  private installTool(name: string) {
    const bin: string = this.findToolFromPath("go");
    if (bin === "") {
      this.terminal.Channel("Could not find Go binary");
      vscode.window.showErrorMessage("Go Outliner: Could not find Go binary");
      return;
    }
    let args: string[] = [];
    switch (name) {
      case "go-outliner":
        args = ["install", "github.com/766b/go-outliner@latest"];
        break;
      default:
        this.terminal.Channel("Trying to install unknown tool: " + name);
        return;
    }

    child.execFile(bin, args, {}, (err, stdout, stderr) => {
      this.terminal.Channel(`Executing ${bin} ${args.join(" ")}`);
      if (err || stderr) {
        this.terminal.Channel(`Error: ${stderr}\n${err}`);
        return;
      }
      this.terminal.Channel(`OK: ${stdout}`);
      this.Reload();
    });
  }

  private findToolFromPath(tool: string): string {
    const cachedPath: string | undefined = this.binPathCache.get(tool);
    if (cachedPath) {
      return cachedPath;
    }

    const toolFileName = process.platform === "win32" ? `${tool}.exe` : tool;

    const paths: string[] = [];
    [
      "GOPATH",
      "GOROOT",
      "HOME",
      process.platform === "win32" ? "Path" : "PATH",
    ].forEach((x) => {
      const env = process.env[x];
      if (!env) {
        return;
      }
      if (x === "HOME") {
        paths.push(path.join(env, "go"));
      } else {
        paths.push(...env.split(path.delimiter));
      }
    });

    for (let i = 0; i < paths.length; i++) {
      const dirs = paths[i].split(path.sep);

      const lookUps: string[] = [path.join(paths[i], toolFileName)];
      if (dirs[dirs.length - 1].toLowerCase() !== "bin") {
        lookUps.push(path.join(paths[i], "bin", toolFileName));
      }
      for (let i = 0; i < lookUps.length; i++) {
        const filePath = lookUps[i];
        if (fileExists(filePath)) {
          this.terminal.Channel(`Found "${tool}" at ${filePath}`);
          this.binPathCache.set(tool, filePath);
          return filePath;
        }
      }
    }
    this.terminal.Channel(`Could not find "${tool}"`);
    return "";
  }

  public dispose() {
    if (this.explorerExtension) {
      this.explorerExtension.dispose();
    }
    this.terminal.dispose();
    this._onDidChangeMain.dispose();
    this._onDidChangeTests.dispose();
    this._onDidChangeBenchmarks.dispose();
  }
}
