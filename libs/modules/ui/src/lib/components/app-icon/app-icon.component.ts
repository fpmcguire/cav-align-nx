/**
 * app-icon.component.ts
 *
 * A typed icon component for the Align UI.
 * Uses Font Awesome Free (loaded via CDN or package) with a strict
 * union type for icon names — prevents typos and enables refactoring.
 *
 * Usage:
 *   <app-icon name="triangle-exclamation" />
 *   <app-icon name="link-slash" [title]="'Disconnected'" />
 *
 * To add a new icon: add the name to the AppIconName union type.
 */
import { Component, input } from '@angular/core';

export type AppIconName =
  // Status / state
  | 'circle-check'
  | 'circle-xmark'
  | 'triangle-exclamation'
  | 'circle-info'
  | 'clock'
  | 'hourglass-half'
  // Connectivity
  | 'link'
  | 'link-slash'
  | 'wifi'
  | 'plug'
  | 'plug-circle-xmark'
  // Data / topics
  | 'wave-square'
  | 'signal'
  | 'chart-line'
  | 'database'
  | 'brackets-curly'
  | 'code-branch'
  // Actions
  | 'play'
  | 'pause'
  | 'stop'
  | 'rotate'
  | 'plus'
  | 'pen-to-square'
  | 'trash'
  | 'xmark'
  | 'chevron-down'
  | 'chevron-right'
  // Layout / nav
  | 'bars'
  | 'sliders'
  | 'magnifying-glass'
  | 'arrow-right-from-bracket'
  // Align-specific
  | 'bolt'           // Divergence confirmed
  | 'bolt-slash'     // Divergence resolved
  | 'eye'            // Observing
  | 'circle-dot'     // Discovering
  | 'layer-group'    // Sessions
  | 'server';        // Broker

@Component({
  selector: 'app-icon',
  template: `
    <i
      class="fa-solid fa-{{ name() }}"
      [attr.title]="title()"
      [attr.aria-hidden]="title() ? null : 'true'"
      [attr.aria-label]="title()"
    ></i>
  `,
  styles: [`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
  `],
})
export class AppIconComponent {
  readonly name = input.required<AppIconName>();
  readonly title = input<string | null>(null);
}
