/**
 * Migrations SQLite, appliquées dans l'ordre et une seule fois (table schema_migrations).
 * Règle : ne jamais modifier une migration publiée ; en ajouter une nouvelle.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "schéma initial",
    sql: `
      CREATE TABLE players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar TEXT NOT NULL DEFAULT '🎯',
        color TEXT NOT NULL DEFAULT '#ff6a00',
        level TEXT NOT NULL DEFAULT 'debutant',
        is_guest INTEGER NOT NULL DEFAULT 0,
        favorite_double INTEGER,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE UNIQUE INDEX players_name_active ON players(name COLLATE NOCASE) WHERE archived_at IS NULL AND is_guest = 0;

      CREATE TABLE matches (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        category TEXT NOT NULL,
        options TEXT NOT NULL,
        config TEXT NOT NULL,
        seed INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'finished', 'abandoned')),
        input_mode TEXT NOT NULL DEFAULT 'manual' CHECK (input_mode IN ('manual', 'autodarts')),
        is_simulation INTEGER NOT NULL DEFAULT 0,
        room_code TEXT NOT NULL UNIQUE,
        fixture_id TEXT,
        winner_ids TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT
      );
      CREATE INDEX matches_status ON matches(status);
      CREATE INDEX matches_created ON matches(created_at);

      CREATE TABLE match_players (
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL REFERENCES players(id),
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (match_id, player_id)
      );
      CREATE INDEX match_players_player ON match_players(player_id);

      CREATE TABLE match_events (
        id TEXT PRIMARY KEY,
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('dart', 'next')),
        segment INTEGER,
        multiplier INTEGER,
        source TEXT NOT NULL,
        external_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'undone', 'replaced')),
        replaces TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX match_events_match ON match_events(match_id, seq);
      CREATE UNIQUE INDEX match_events_external ON match_events(match_id, external_id) WHERE external_id IS NOT NULL;

      CREATE TABLE match_commands (
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        command_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (match_id, command_id)
      );

      CREATE TABLE match_visits (
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        visit_index INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        category TEXT NOT NULL,
        leg INTEGER NOT NULL,
        set_no INTEGER NOT NULL,
        round INTEGER NOT NULL,
        points INTEGER NOT NULL,
        raw_points INTEGER NOT NULL,
        darts TEXT NOT NULL,
        darts_count INTEGER NOT NULL,
        bust INTEGER NOT NULL,
        checkout INTEGER NOT NULL,
        checkout_chance INTEGER NOT NULL,
        first_of_leg INTEGER NOT NULL,
        remaining_before INTEGER,
        remaining_after INTEGER,
        hits INTEGER,
        attempts INTEGER,
        marks INTEGER,
        end_reason TEXT NOT NULL,
        out_rule TEXT,
        is_simulation INTEGER NOT NULL,
        played_at TEXT NOT NULL,
        PRIMARY KEY (match_id, visit_index)
      );
      CREATE INDEX match_visits_player ON match_visits(player_id, played_at);

      CREATE TABLE match_results (
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        won INTEGER NOT NULL,
        final_score INTEGER,
        darts INTEGER NOT NULL,
        points INTEGER NOT NULL,
        legs_won INTEGER,
        sets_won INTEGER,
        average3 REAL,
        PRIMARY KEY (match_id, player_id)
      );

      CREATE TABLE exercises (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        options TEXT NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE weekly_goals (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES players(id),
        metric TEXT NOT NULL,
        target REAL NOT NULL,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE competitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('knockout', 'round_robin')),
        match_options TEXT NOT NULL,
        points_win INTEGER NOT NULL DEFAULT 2,
        points_draw INTEGER NOT NULL DEFAULT 1,
        double_round INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
        winner_id TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE competition_players (
        competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL REFERENCES players(id),
        seed INTEGER NOT NULL,
        PRIMARY KEY (competition_id, player_id)
      );

      CREATE TABLE competition_fixtures (
        id TEXT PRIMARY KEY,
        competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
        round INTEGER NOT NULL,
        slot INTEGER NOT NULL,
        player1_id TEXT,
        player2_id TEXT,
        winner_id TEXT,
        score1 INTEGER,
        score2 INTEGER,
        match_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'playing', 'done', 'bye')),
        scheduled_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX competition_fixtures_comp ON competition_fixtures(competition_id, round, slot);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE autodarts_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        provider TEXT NOT NULL,
        simulated INTEGER NOT NULL,
        summary TEXT NOT NULL,
        match_id TEXT,
        outcome TEXT NOT NULL
      );
      CREATE INDEX autodarts_events_received ON autodarts_events(received_at);
    `,
  },
];
