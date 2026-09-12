import { Component, OnInit, signal } from '@angular/core';
import { LabService, LabDetail } from '../lab.service';
import { TerminalComponent } from '../terminal/terminal.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TerminalComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  labs = signal<LabDetail[]>([]);
  selectedInstructions = signal<string | null>(null);
  loadError = signal<string | null>(null);
  showTerminal = signal(false);

  constructor(private labService: LabService) {}

  ngOnInit(): void {
    console.log('ngOnInit: fetching labs...');
    this.labService.getLabs().subscribe({
      next: (labs) => {
        console.log('labs received:', labs);
        this.labs.set(labs);
      },
      error: (err) => {
        console.error('Failed to load labs', err);
        this.loadError.set('Failed to load labs. Is the backend running on port 8080?');
      }
    });
  }

  selectLab(lab: LabDetail): void {
    this.selectedInstructions.set(lab.instructions);
    this.showTerminal.set(true);
  }
}
