import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('MQTT-Align VS Code extension activated');

  const disposable = vscode.commands.registerCommand('mqtt-align.hello', () => {
    vscode.window.showInformationMessage('MQTT-Align is active.');
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  return;
}
