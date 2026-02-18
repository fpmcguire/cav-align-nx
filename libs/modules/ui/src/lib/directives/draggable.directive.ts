/**
 * draggable.directive.ts
 *
 * A pointer-events-based drag directive for floating panels and popups.
 * Supports an optional drag handle selector, viewport clamping, and
 * pointer capture for reliable drag across fast mouse movements.
 *
 * Usage:
 *   <div appDraggable appDraggableHandle=".panel-header"> ... </div>
 *
 * Ported from angular-fleet-management-view and adapted for Align.
 */
import { Directive, ElementRef, inject, input } from '@angular/core';

@Directive({
  selector: '[appDraggable]',
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(document:pointermove)': 'onPointerMove($event)',
    '(document:pointerup)': 'onPointerUp($event)',
  },
})
export class DraggableDirective {
  /** Optional CSS selector for a drag handle inside the host element. */
  readonly appDraggableHandle = input<string | null>(null);

  private readonly elRef = inject(ElementRef<HTMLElement>);

  private dragging = false;
  private pointerId: number | null = null;
  private startOffsetX = 0;
  private startOffsetY = 0;

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;

    const host = this.elRef.nativeElement;
    const targetEl = this.resolveTarget(event);
    if (!targetEl) return;

    const handleSelector = this.appDraggableHandle();
    if (handleSelector) {
      const handle = host.querySelector(handleSelector);
      if (!handle || !handle.contains(targetEl)) return;
    }

    // Do not interfere with interactive controls within the draggable area.
    if (
      targetEl.closest(
        'button, input, select, textarea, a[href], [role="button"], [contenteditable="true"]'
      )
    ) {
      return;
    }

    event.preventDefault();

    const rect = host.getBoundingClientRect();
    this.startOffsetX = event.clientX - rect.left;
    this.startOffsetY = event.clientY - rect.top;

    // Lock to fixed positioning to allow free movement.
    host.style.position = 'fixed';
    host.style.margin = '0';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;

    this.dragging = true;
    this.pointerId = event.pointerId;
    host.setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;

    const host = this.elRef.nativeElement;
    const rect = host.getBoundingClientRect();

    const nextLeft = event.clientX - this.startOffsetX;
    const nextTop = event.clientY - this.startOffsetY;

    // Clamp within viewport bounds.
    const clampedLeft = Math.min(
      Math.max(0, nextLeft),
      Math.max(0, window.innerWidth - rect.width)
    );
    const clampedTop = Math.min(
      Math.max(0, nextTop),
      Math.max(0, window.innerHeight - rect.height)
    );

    host.style.left = `${clampedLeft}px`;
    host.style.top = `${clampedTop}px`;
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.dragging) return;
    if (this.pointerId !== null && event.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.pointerId = null;
  }

  private resolveTarget(event: Event): Element | null {
    const path = event.composedPath?.() ?? [];
    for (const item of path) {
      if (item instanceof Element) return item;
    }
    return event.target instanceof Element ? event.target : null;
  }
}
