import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LabService, LabDetail } from '../lab.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  labs: LabDetail[] = [];
  selectedInstructions: string | null = null;
  loadError: string | null = null;

  constructor(private labService: LabService) {}

  ngOnInit(): void {
    this.labService.getLabs().subscribe({
      next: (labs) => (this.labs = labs),
      error: (err) => {
        console.error('Failed to load labs', err);
        this.loadError = 'Failed to load labs. Is the backend running on port 8080?';
      }
    });
  }

  selectLab(lab: LabDetail): void {
    this.selectedInstructions = lab.instructions;
  }
}
