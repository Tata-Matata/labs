import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the home page title and load labs', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    TestBed.inject(HttpTestingController).expectOne('/api/labs').flush([
      { id: '1', title: 'Lab One', description: 'First lab', instructions: 'Do it' },
    ]);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('DevOps Labs');
    expect(compiled.querySelector('.lab-title')?.textContent).toContain('Lab One');
  });
});
