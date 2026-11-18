import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SchPuzzleOverlay } from './shared/puzzle-transition';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SchPuzzleOverlay],
  template: `<router-outlet /><sch-puzzle-overlay />`,
})
export class App {}
