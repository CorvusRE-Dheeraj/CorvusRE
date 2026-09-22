import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SiteNav, SiteFooter } from "../components/SiteChrome";
import { AuthProvider } from "../lib/auth";
import { Toaster } from "../components/ui/sonner";
import { TooltipProvider } from "../components/ui/tooltip";
import { AppShell } from "../components/AppShell";
import { AskAiWidget } from "../components/AskAiWidget";
import { ProfileGate } from "../components/ProfileGate";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has moved.
        </p>
        <div className="mt-6">
          <Link to="/" className="btn-primary btn-primary-hover">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. Try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="btn-primary btn-primary-hover"
          >
            Try again
          </button>
          {/* A plain reload, not <Link> — the router itself may be what's
              broken here, so this deliberately doesn't depend on it. Still
              needs the real base path though (SITE_BASE, e.g. "/corvusdp/"),
              or this 404s in production instead of reaching the app. */}
          <a href={import.meta.env.BASE_URL} className="btn-outline">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CorvusDP — AI-assisted permitting & design" },
      {
        name: "description",
        content:
          "CorvusDP helps owners, developers and engineering teams run permitting, entitlement and design for ground-up and expansion projects across US jurisdictions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: `${import.meta.env.BASE_URL}favicon.svg?v=7`, type: "image/svg+xml" },
      { rel: "icon", href: `${import.meta.env.BASE_URL}favicon.ico?v=2`, sizes: "any" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={200}>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-foreground"
          >
            Skip to main content
          </a>
          {/* flex-col + min-h-screen + main:flex-1 is what pins the footer to
              the bottom of the viewport on short pages (e.g. Settings)
              instead of leaving a gap between it and the end of the
              document — on tall pages this has no effect, the footer just
              sits after the (taller) content as always. */}
          <div className="flex min-h-screen flex-col">
            <div className="print:hidden">
              <SiteNav />
            </div>
            <main id="main-content" className="flex-1">
              <AppShell>
                <Outlet />
              </AppShell>
            </main>
            <div className="print:hidden">
              <SiteFooter />
            </div>
          </div>
          <div className="print:hidden">
            <AskAiWidget />
          </div>
          <ProfileGate />
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
