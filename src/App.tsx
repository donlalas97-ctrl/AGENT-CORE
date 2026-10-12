import { MissionControl } from '@/components/MissionControl';
import { CoreEngineStatus } from '@/components/CoreEngineStatus';

function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-slate-100">AGENT</h1>
          <p className="text-sm text-slate-500 mt-1">
            Core Engine — local-first AI orchestration
          </p>
        </header>

        <div className="space-y-8">
          <section>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Command
            </h2>
            <MissionControl />
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
              Engine Status
            </h2>
            <CoreEngineStatus />
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
