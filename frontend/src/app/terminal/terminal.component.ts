import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

interface TerminalMessage {
  type: 'input' | 'output' | 'resize' | 'error';
  data?: string;
  cols?: number;
  rows?: number;
}

@Component({
  selector: 'app-terminal',
  standalone: true,
  template: `<div #terminalContainer class="terminal-container"></div>`,
  styleUrls: ['./terminal.component.scss']
})
export class TerminalComponent implements AfterViewInit, OnDestroy {
  @ViewChild('terminalContainer', { static: true })
  terminalContainer!: ElementRef<HTMLDivElement>;

  private term!: Terminal;
  private readonly fitAddon = new FitAddon();
  private socket?: WebSocket;
  private resizeObserver?: ResizeObserver;
  private terminalDisposables: Array<{ dispose(): void }> = [];

  ngAfterViewInit(): void {
    this.term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Consolas, monospace',
      fontSize: 14,
      theme: {
        background: '#000000',
        foreground: '#ffffff'
      }
    });
    this.term.loadAddon(this.fitAddon);

    this.term.open(this.terminalContainer.nativeElement);
    this.term.writeln('Connecting to lab container...');
    this.term.focus();
    this.fitTerminal();
    this.watchContainerResize();

    this.terminalDisposables.push(
      this.term.onData((data) => this.forwardInput(data)),
      this.term.onResize(({ cols, rows }) => this.sendResize(cols, rows))
    );

    this.connect();
  }

  private connect(): void {
    this.socket = new WebSocket(this.buildSocketUrl());

    this.socket.addEventListener('open', () => {
      this.term.writeln('Connected.');
      this.sendResize(this.term.cols, this.term.rows);
    });

    this.socket.addEventListener('message', (event) => {
      const message = this.parseMessage(event.data);
      if (!message) {
        return;
      }

      if (message.type === 'output' && message.data) {
        this.term.write(message.data);
        return;
      }

      if (message.type === 'error') {
        this.term.writeln(`\r\n[terminal error] ${message.data ?? 'Unknown error'}`);
      }
    });

    this.socket.addEventListener('close', (event) => {
      const reason = event.reason ? ` ${event.reason}` : '';
      this.term.writeln(`\r\n[terminal closed] code=${event.code}${reason}`);
    });

    this.socket.addEventListener('error', () => {
      this.term.writeln('\r\n[terminal connection failed]');
    });
  }

  private forwardInput(data: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify({ type: 'input', data } satisfies TerminalMessage));
  }

  private sendResize(cols: number, rows: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN || cols <= 0 || rows <= 0) {
      return;
    }

    this.socket.send(JSON.stringify({ type: 'resize', cols, rows } satisfies TerminalMessage));
  }

  private watchContainerResize(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.fitTerminal();
      this.sendResize(this.term.cols, this.term.rows);
    });

    this.resizeObserver.observe(this.terminalContainer.nativeElement);
  }

  private fitTerminal(): void {
    queueMicrotask(() => this.fitAddon.fit());
  }

  private buildSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/api/terminal/stream`;
  }

  private parseMessage(payload: string): TerminalMessage | null {
    try {
      return JSON.parse(payload) as TerminalMessage;
    } catch {
      this.term.writeln('\r\n[terminal protocol error]');
      return null;
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    for (const disposable of this.terminalDisposables) {
      disposable.dispose();
    }
    this.socket?.close();
    this.term?.dispose();
  }
}
