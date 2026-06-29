import { getPost } from "../posts";
import { postMetadata } from "../post-meta";
import { CodeBlock } from "../../site-chrome";
import { PostLayout, Lead, P, Step } from "../post-layout";

const meta = getPost("angular-analytics-in-5-minutes")!;

export const metadata = postMetadata(meta.slug);

export default function Post() {
  return (
    <PostLayout meta={meta}>
      <Lead>
        <code className="font-mono text-text-primary">@counted/sdk</code> drops into any
        Angular 17+ app without a cookie banner or a 50KB script. Here&apos;s the whole
        thing — a DI service, auto page views on every route, and a custom event —
        in about five minutes.
      </Lead>

      <Step n={1} title="Get a project key">
        <P>
          Create a project and copy its <strong>client key</strong> (starts with{" "}
          <code className="font-mono text-text-primary">ck_</code>) — or mint one with no
          signup:
        </P>
        <div className="mt-3">
          <CodeBlock>{`curl -X POST https://app.counted.dev/api/v0/provision`}</CodeBlock>
        </div>
        <P>
          Put the key in{" "}
          <code className="font-mono text-text-primary">src/environments/environment.ts</code>.
          If you don&apos;t have that file yet, generate it with{" "}
          <code className="font-mono text-text-primary">ng generate environments</code>:
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/environments/environment.ts
export const environment = {
  countedProjectKey: 'ck_your_project_key',
};`}</CodeBlock>
        </div>
        <P>Client keys are write-only — safe to ship in the browser.</P>
      </Step>

      <Step n={2} title="Install the SDK">
        <div className="mt-1">
          <CodeBlock>{`npm install @counted/sdk`}</CodeBlock>
        </div>
      </Step>

      <Step n={3} title="Create an AnalyticsService">
        <P>
          Angular&apos;s DI makes this a natural singleton across your whole app.
          The{" "}
          <code className="font-mono text-text-primary">isPlatformBrowser</code> check
          keeps the SDK out of Angular SSR builds where{" "}
          <code className="font-mono text-text-primary">window</code> doesn&apos;t exist.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/app/analytics.service.ts
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
}`}</CodeBlock>
        </div>
      </Step>

      <Step n={4} title="Auto-track page views">
        <P>
          Subscribe to{" "}
          <code className="font-mono text-text-primary">Router.events</code> in{" "}
          <code className="font-mono text-text-primary">AppComponent</code> and filter to{" "}
          <code className="font-mono text-text-primary">NavigationEnd</code>. This fires
          after every successful navigation — including the initial load — so one
          subscription covers everything.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/app/app.component.ts
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
}`}</CodeBlock>
        </div>
        <P>
          Every page your users visit now appears in the dashboard as a{" "}
          <code className="font-mono text-text-primary">page_view</code> event. Build
          funnels, breakdowns by path, or retention curves — all from the same event shape.
        </P>
      </Step>

      <Step n={5} title="Track a custom event">
        <P>
          Inject{" "}
          <code className="font-mono text-text-primary">AnalyticsService</code> in any
          component and call{" "}
          <code className="font-mono text-text-primary">track()</code>. Properties are
          plain values — no user IDs, no PII.
        </P>
        <div className="mt-3">
          <CodeBlock>{`// src/app/upgrade-button.component.ts
import { Component, inject } from '@angular/core';
import { AnalyticsService } from './analytics.service';

@Component({
  selector: 'app-upgrade-button',
  standalone: true,
  template: \`<button (click)="upgrade()">Upgrade</button>\`,
})
export class UpgradeButtonComponent {
  private analytics = inject(AnalyticsService);

  upgrade() {
    this.analytics.track('upgrade_click', { plan: 'pro' });
  }
}`}</CodeBlock>
        </div>
        <P>
          Your event shows up on the dashboard within a second or two. Add as many
          properties as you want — breakdowns, time series, and funnels compose from
          whatever shape you send.
        </P>
      </Step>
    </PostLayout>
  );
}
