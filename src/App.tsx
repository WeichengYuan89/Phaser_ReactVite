import { GameRoute } from './study/GameRoute';
import { TestRoute } from './study/TestRoute';

/**
 * Two activities, two front-ends (INTEGRATION_DESIGN §3):
 *
 *   /       the Phaser training game
 *   /test   the pre/post psychometric test — plain React, no Phaser
 *
 * A hand-rolled switch rather than react-router: there are exactly two screens,
 * they never nest, and no navigation happens during a session. Vite's SPA
 * fallback serves index.html for /test in both `dev` and `preview`.
 */
function currentRoute (): 'game' | 'test'
{
    return window.location.pathname.replace(/\/+$/, '').endsWith('/test') ? 'test' : 'game';
}

function App ()
{
    return currentRoute() === 'test' ? <TestRoute /> : <GameRoute />;
}

export default App;
