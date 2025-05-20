"use strict";

import * as vscode from "vscode";
import { join, dirname } from "path";

export enum ItemType {
  None = "none",
  Type = "type",
  Func = "func",
  Var = "var",
  Const = "const",
}

const iconsRootPath = join(dirname(__dirname), "resources", "icons");

function getIcons(iconName: string): object {
  return {
    light: vscode.Uri.file(join(iconsRootPath, "light", `${iconName}.svg`)),
    dark: vscode.Uri.file(join(iconsRootPath, "dark", `${iconName}.svg`)),
  };
}

export class Symbol {
  label: string = "";
  type: string = "";
  receiver: string = "";
  file: string = "";
  start: number = 0;
  end: number = 0;
  line: number = 0;

  collapsibleState: vscode.TreeItemCollapsibleState =
    vscode.TreeItemCollapsibleState.None;

  rootType: ItemType = ItemType.None;

  get contextValue(): string {
    return "symbol";
  }

  get command():
    | { title: string; command: string; arguments: unknown }
    | undefined {
    if (this.rootType !== ItemType.None) {
      return undefined;
    }

    return {
      title: "Open File",
      command: "goOutliner.OpenItem",
      arguments: [this],
    };
  }

  get iconPath(): object | undefined {
    if (this.rootType !== ItemType.None) {
      return undefined;
    }
    switch (this.type) {
      case "type":
        return getIcons("class");
      case "var":
        return getIcons("field");
      case "const":
        return getIcons("constant");
      case "func":
        return getIcons("method");
      default:
        return undefined;
    }
  }

  get isTestFile(): boolean {
    return this.file.toLowerCase().endsWith("_test.go");
  }

  static fromObject(src: unknown) {
    return Object.assign(new Symbol(), src);
  }

  static NewRootItem(type: ItemType): Symbol {
    const s = new Symbol();
    switch (type) {
      case ItemType.Func:
        s.label = "Functions";
        break;
      case ItemType.Const:
        s.label = "Constants";
        break;
      case ItemType.Var:
        s.label = "Variables";
        break;
      case ItemType.Type:
        s.label = "Types";
        break;
    }
    s.rootType = type;
    s.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    return s;
  }
}
