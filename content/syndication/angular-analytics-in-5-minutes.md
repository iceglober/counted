---
title: Add product analytics to your Angular app in 5 minutes
description: Drop @counted/sdk into any Angular 17+ app, auto-track page views with the Router, and fire custom events from any component — no cookies, under 3KB.
tags: angular, typescript, analytics, privacy, webdev
canonical_url: https://counted.dev/blog/angular-analytics-in-5-minutes
published: false
---

[Counted](https://counted.dev) drops into any Angular 17+ app in a handful of lines — no cookie banner, no consent wall, no 50KB bundle. Here's the whole setup.

## 1. Get a project key

Create a project and copy its `ck_` client key — or provision one without signing up:

```bash
curl -X POST https://app.counted.dev/api/v0/provision
```

Add the key to `src/environments/environment.ts`. If you don't have that file yet, generate it with `ng generate environments`:

```ts
// src/environments/environment.ts
export const environment = {
  countedProjectKey: 'ck_your_project_key',
};
```

Client keys are write-only — safe to ship in the browser.

## 2. Install

```bash
npm install @counted/sdk
```

## 3. Create an AnalyticsService

Angular's DI makes this a natural singleton across your whole app. The `isPlatformBrowser` check keeps the SDK out of Angular SSR builds where `window` doesn't exist.

```ts
// src/app/analytics.service.ts
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Analytics } from '@counted/sdk';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private analytics: Analytics | null = null;

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      this.analytics = new Analytics({
        projectKey: environment.countedProjectKey,
      });
    }
  }

  track(event: string, properties?: Record<string, unknown>) {
    this.analytics?.track(event, properties);
  }
}
```

## 4. Auto-track page views

Subscribe to `Router.events` in `AppComponent` and filter to `NavigationEnd`. This fires after every successful navigation — including the initial load — so one subscription covers everything.

```ts
// src/app/app.component.ts
import { Component, inject, OnInit } from '@angular/core';
import { Router, NavigationEnd, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AnalyticsService } from './analytics.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent implements OnInit {
  private router = inject(Router);
  private analytics = inject(AnalyticsService);

  ngOnInit() {
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd)
    ).subscribe(e => {
      this.analytics.track('page_view', { path: e.urlAfterRedirects });
    });
  }
}
```

Every page your users visit now appears in the dashboard as a `page_view` event. Build funnels, breakdowns by path, or retention curves — all from the same event shape.

## 5. Track a custom event

Inject `AnalyticsService` in any component and call `track()`. Properties are plain values — no user IDs, no PII.

```ts
// src/app/upgrade-button.component.ts
import { Component, inject } from '@angular/core';
import { AnalyticsService } from './analytics.service';

@Component({
  selector: 'app-upgrade-button',
  standalone: true,
  template: `<button (click)="upgrade()">Upgrade</button>`,
})
export class UpgradeButtonComponent {
  private analytics = inject(AnalyticsService);

  upgrade() {
    this.analytics.track('upgrade_click', { plan: 'pro' });
  }
}
```

Your event shows up on the dashboard within a second or two. Add as many properties as you want — breakdowns, time series, and funnels compose from whatever shape you send.

*Originally published on [counted.dev](https://counted.dev/blog/angular-analytics-in-5-minutes).*
