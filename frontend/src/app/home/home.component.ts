import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Lab {
  id: string;
  title: string;
  description: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent {
  labs: Lab[] = [
    { id: 'k8s-basics', title: 'Kubernetes Basics', description: 'Pods, Deployments, Services' },
    { id: 'terraform-intro', title: 'Terraform Intro', description: 'Providers, Resources, State' },
    { id: 'linux-fundamentals', title: 'Linux Fundamentals', description: 'Filesystem, Permissions, Processes' },
    { id: 'k8s-networking', title: 'Kubernetes Networking', description: 'Ingress, NetworkPolicy, DNS' },
    { id: 'terraform-modules', title: 'Terraform Modules', description: 'Reusable Infrastructure' },
    { id: 'linux-scripting', title: 'Linux Scripting', description: 'Bash, Cron, Automation' }
  ];

  selectLab(lab: Lab): void {
    console.log('Selected lab:', lab.id);
    // TODO: navigate to lab session route
  }
}
