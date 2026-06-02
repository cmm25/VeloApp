import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { lazy, Suspense } from "react";
import { queryClient } from "@/lib/queryClient";
import { Web3Provider } from "@/components/Web3Provider";
import { RequireRole, RequireWallet } from "@/components/RoleGate";
import { FullPageLoader } from "@/components/ui/spinner";

const Landing = lazy(() => import("@/pages/Landing"));
const ChooseRole = lazy(() => import("@/pages/ChooseRole"));
const CoachHome = lazy(() => import("@/pages/coach/CoachHome"));
const NewJob = lazy(() => import("@/pages/coach/NewJob"));
const JobDetail = lazy(() => import("@/pages/coach/JobDetail"));
const AthleteHome = lazy(() => import("@/pages/athlete/AthleteHome"));
const AthleteWorkspace = lazy(() => import("@/pages/coach/AthleteWorkspace"));
const PublicProfile = lazy(() => import("@/pages/PublicProfile"));
const AgentsDirectory = lazy(() => import("@/pages/agents/AgentsDirectory"));
const AgentProfile = lazy(() => import("@/pages/agents/AgentProfile"));
const BountiesBoard = lazy(() => import("@/pages/bounties/BountiesBoard"));
const BountyDetail = lazy(() => import("@/pages/bounties/BountyDetail"));
const DeleteAccount = lazy(() => import("@/pages/DeleteAccount"));
const NotFound = lazy(() => import("@/pages/not-found"));

function Router() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/choose-role">
          {() => (
            <RequireWallet>
              <ChooseRole />
            </RequireWallet>
          )}
        </Route>
        <Route path="/coach">
          {() => (
            <RequireRole role="coach">
              <CoachHome />
            </RequireRole>
          )}
        </Route>
        <Route path="/coach/new">
          {() => (
            <RequireRole role="coach">
              <NewJob />
            </RequireRole>
          )}
        </Route>
        <Route path="/coach/jobs/:jobId">
          {(params) => (
            <RequireRole role="coach">
              <JobDetail jobId={params.jobId as `0x${string}`} />
            </RequireRole>
          )}
        </Route>
        <Route path="/coach/athletes/:address">
          {(params) => (
            <RequireRole role="coach">
              <AthleteWorkspace address={params.address} />
            </RequireRole>
          )}
        </Route>
        <Route path="/athlete">
          {() => (
            <RequireRole role="athlete">
              <AthleteHome />
            </RequireRole>
          )}
        </Route>
        <Route path="/account/delete">
          {() => (
            <RequireWallet>
              <DeleteAccount />
            </RequireWallet>
          )}
        </Route>
        <Route path="/p/:address">
          {(params) => <PublicProfile address={params.address} />}
        </Route>
        <Route path="/agents" component={AgentsDirectory} />
        <Route path="/a/:address">
          {(params) => <AgentProfile address={params.address} />}
        </Route>
        <Route path="/bounties" component={BountiesBoard} />
        <Route path="/bounties/:id">
          {(params) => <BountyDetail id={params.id} />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Web3Provider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster theme="dark" position="bottom-right" richColors />
      </Web3Provider>
    </QueryClientProvider>
  );
}
