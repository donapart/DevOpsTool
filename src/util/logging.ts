import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('DevOps Hybrid');
    }
    return outputChannel;
}

function isDebugEnabled(): boolean {
    return vscode.workspace.getConfiguration('devops').get<boolean>('debugLogging', false);
}

function formatMessage(level: string, tag: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${tag}] ${message}`;
}

export function logDebug(tag: string, message: string): void {
    if (isDebugEnabled()) {
        const formatted = formatMessage('DEBUG', tag, message);
        getChannel().appendLine(formatted);
        console.log(formatted);
    }
}

export function logInfo(tag: string, message: string): void {
    const formatted = formatMessage('INFO', tag, message);
    getChannel().appendLine(formatted);
    if (isDebugEnabled()) {
        console.log(formatted);
    }
}

export function logWarn(tag: string, message: string): void {
    const formatted = formatMessage('WARN', tag, message);
    getChannel().appendLine(formatted);
    console.warn(formatted);
}

export function logError(tag: string, message: string, error?: unknown): void {
    const errorDetails = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : '';
    const formatted = formatMessage('ERROR', tag, `${message}${errorDetails}`);
    getChannel().appendLine(formatted);
    console.error(formatted);
    if (error instanceof Error && error.stack && isDebugEnabled()) {
        getChannel().appendLine(error.stack);
    }
}

export function showChannel(): void {
    getChannel().show();
}
