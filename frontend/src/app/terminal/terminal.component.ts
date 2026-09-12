import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { Terminal } from '@xterm/xterm';

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
  private currentLine = '';

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

    this.term.open(this.terminalContainer.nativeElement);
    this.term.writeln('Welcome to the lab terminal (demo mode, no backend yet).');
    this.writePrompt();

    this.term.onData((data) => this.handleInput(data));
  }

  private handleInput(data: string): void {
    const code = data.charCodeAt(0);

    if (data === '\r') {
      this.term.writeln('');
      this.term.writeln(`(demo) you typed: ${this.currentLine}`);
      this.currentLine = '';
      this.writePrompt();
      return;
    }

    if (code === 127) {
      if (this.currentLine.length > 0) {
        this.currentLine = this.currentLine.slice(0, -1);
        this.term.write('\b \b');
      }
      return;
    }

    this.currentLine += data;
    this.term.write(data);
  }

  private writePrompt(): void {
    this.term.write('\r\n$ ');
  }

  ngOnDestroy(): void {
    this.term?.dispose();
  }
}
