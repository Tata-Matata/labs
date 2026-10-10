import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild
} from '@angular/core';

//JavaScript terminal emulator
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

// AfterViewInit = after Angular has created the component's view/DOM
// important here because xterm needs an actual DOM element to attach itself to.
export class TerminalComponent implements AfterViewInit, OnDestroy {
  //`!` is TypeScript's definite assignment assertion. 
  // Without it, TypeScript might complain: Property 'terminalContainer' has no initializer. Because you don't do:
  //terminalContainer = ... . 
  // Angular populates it later. So you're telling TypeScript
  //that Angular will initialize this before using it
  @ViewChild('terminalContainer', { static: true })
  terminalContainer!: ElementRef<HTMLDivElement>;

  // will have been initialized later, before it is used
  // without it Typescript complains that not initialized in constructor
  // compare to private socket?: WebSocket = may not be initialized
  private term!: Terminal;

  //Creates an xterm addon responsible for fitting the terminal to its container.
  // this.fitAddon.fit();
  private readonly fitAddon = new FitAddon();

  //websocket is optional (socket: WebSocket | undefined)
  // Initially there is no WebSocket.
  private socket?: WebSocket;
  private resizeObserver?: ResizeObserver;

  // onData and onResize return disposable objects
  // these will be stored in the array
  // disposable.dispose(); will remove the event listeners in ngOnDestroy
  private terminalDisposables: Array<{ dispose(): void }> = [];

  //xterm attaches itself to the DOM component already created earlier
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
    
    //attach yourself to <div #terminalContainer class="terminal-container"></div>
    this.term.open(this.terminalContainer.nativeElement);
    this.term.writeln('Connecting to lab container...');


    this.term.focus();
    this.fitTerminal();

    // if browser resized - terminal <div> changed size
    // xterm recalculates cols/rows --> backend is told about new terminal size
    // PTY gets resized
    this.watchContainerResize();

    // event listeners to be disposed in ngOnDestroy
    // onData is for sending input data via WebSocket to backend
    // onResize for sending new number of rows and columns via WebSocket to backend
    this.terminalDisposables.push(
      this.term.onData((data) => this.forwardInput(data)),
      this.term.onResize(({ cols, rows }) => this.sendResize(cols, rows))
    );


    this.connect();
  }

  //connect and manage connection to backend via WebSocket
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

  // queueMicrotask = DOM/layout may still be in the process of updating 
  // when the resize callback executes. 
  // Scheduling fit() allows the current operation to finish 
  // before xterm measures the element.
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
