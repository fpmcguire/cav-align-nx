import { Component, afterNextRender, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  template: `<router-outlet />`,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class App {
  private auth = inject(AuthService);

  constructor() {
    afterNextRender(() => {
      this.auth.init();
    });
  }
}
