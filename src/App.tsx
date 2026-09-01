import { GameRoute, ResearcherSetupRoute } from './study/GameRoute';
import { TestRoute } from './study/TestRoute';
import { REMOTE_PILOT } from './study/sessionStore';

/**
 * D24 keeps participant and researcher surfaces separate:
 *
 *   /       the Phaser training game
 *   /researcher local experimenter setup (never participant-facing)
 *   /test       retained psychometric artefact — not in the D24 pilot
 *
 * A hand-rolled switch is enough because these routes never nest. Researcher
 * setup and the retained assessment route are development-only; the pilot
 * production UI exposes only the participant route.
 */
function currentRoute (): 'game' | 'researcher' | 'test'
{
    const path = window.location.pathname.replace(/\/+$/, '');

    if (path.endsWith('/researcher'))
    {
        return 'researcher';
    }

    return path.endsWith('/test') ? 'test' : 'game';
}

function App ()
{
    const route = currentRoute();

    if (route === 'researcher' && import.meta.env.DEV)
    {
        return <ResearcherSetupRoute />;
    }

    return <>
        {REMOTE_PILOT && <div className="preview-banner">Technical preview · synthetic participants only · not approved for research data</div>}
        {route === 'test' && import.meta.env.DEV ? <TestRoute /> : <GameRoute />}
    </>;
}

export default App;
