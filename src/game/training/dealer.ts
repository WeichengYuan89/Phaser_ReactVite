/**
 * Carrier-sentence dealer — TRAINING_LOOP.md §5.
 *
 * Shuffle-without-replacement over the 20 sentences: deal the whole pool before
 * reshuffling, so no sentence repeats until every other one has played and
 * repeats are maximally spaced. This is where the anti-memorisation work
 * happens — the sentence is chosen **independently of the difficulty cell**, so
 * the participant cannot learn "this sentence means woman".
 *
 * The independence is also what makes prefetching possible (INTEGRATION_DESIGN
 * §4.3): the dealer knows the next sentence before the staircase knows the next
 * cell.
 */

import { TRAIN_TOKENS } from '../data/stimulusCatalog';
import { shuffled } from '../../shared/random';

export class Dealer
{
    private deck: string[] = [];
    private lastDealt: string | null = null;

    constructor (
        private readonly tokens: readonly string[] = TRAIN_TOKENS,
        private readonly rng: () => number = Math.random
    )
    {
        if (tokens.length < 2)
        {
            throw new Error(`The dealer needs at least 2 sentences, got ${tokens.length}.`);
        }
    }

    /** Sentences left in the current deal, before a reshuffle is needed. */
    get remaining (): number
    {
        return this.deck.length;
    }

    next (): string
    {
        if (this.deck.length === 0)
        {
            this.deck = shuffled(this.tokens, this.rng);

            // A fresh deal whose first card is the one just played would put an
            // adjacent repeat exactly at the deck boundary — the one place
            // shuffle-without-replacement does not protect. Swap it away.
            if (this.deck[this.deck.length - 1] === this.lastDealt)
            {
                const swapWith = this.deck.length - 2;
                [this.deck[this.deck.length - 1], this.deck[swapWith]]
                    = [this.deck[swapWith], this.deck[this.deck.length - 1]];
            }
        }

        const token = this.deck.pop() as string;

        this.lastDealt = token;

        return token;
    }
}
