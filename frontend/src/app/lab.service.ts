import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface LabDetail {
  id: string;
  title: string;
  description: string;
  instructions: string;
}

@Injectable({ providedIn: 'root' })
export class LabService {
  private baseUrl = 'http://localhost:8080/api/labs';

  constructor(private http: HttpClient) {}

  getLabs(): Observable<LabDetail[]> {
    return this.http.get<LabDetail[]>(this.baseUrl);
  }

  getLab(id: string): Observable<LabDetail> {
    return this.http.get<LabDetail>(`${this.baseUrl}/${id}`);
  }
}
