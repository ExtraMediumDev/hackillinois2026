use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("PROGRAM_ID_PLACEHOLDER");

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_GRID_TILES: usize = 100; // 10×10
const MAX_PLAYERS: usize = 10;

// ─── Program ──────────────────────────────────────────────────────────────────
#[program]
pub mod ignite {
    use super::*;

    /// Initialize a new game: create GameState and EscrowVault PDAs.
    /// Only the authority (Ignite server keypair) can call this.
    pub fn initialize_game(
        ctx: Context<InitializeGame>,
        game_id: [u8; 16],
        buy_in: u64,
        grid_size: u8,
    ) -> Result<()> {
        require!(grid_size <= 10, IgniteError::InvalidGridSize);
        let game = &mut ctx.accounts.game_state;
        game.game_id = game_id;
        game.authority = ctx.accounts.authority.key();
        game.status = 0; // waiting
        game.grid_size = grid_size;
        // Initialize grid: all safe (0)
        game.grid = vec![0u8; (grid_size as usize) * (grid_size as usize)];
        game.players = vec![];
        game.buy_in = buy_in;
        game.prize_pool = 0;
        game.winner = None;
        game.created_at = Clock::get()?.unix_timestamp;
        game.collapse_round = 0;
        Ok(())
    }

    /// Player joins a game by transferring USDC to the escrow vault.
    pub fn join_game(
        ctx: Context<JoinGame>,
        game_id: [u8; 16],
        player_pubkey: Pubkey,
        start_x: u8,
        start_y: u8,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game_state;

        require!(game.status == 0, IgniteError::GameNotJoinable);
        require!(
            game.players.len() < MAX_PLAYERS,
            IgniteError::GameFull
        );

        // Ensure starting tile is safe
        let tile_idx = (start_y as usize) * (game.grid_size as usize) + (start_x as usize);
        require!(tile_idx < game.grid.len(), IgniteError::OutOfBounds);
        require!(game.grid[tile_idx] == 0, IgniteError::TileIsLava);

        // Ensure spot not occupied
        for p in &game.players {
            require!(
                !(p.x == start_x && p.y == start_y),
                IgniteError::TileOccupied
            );
        }

        // Transfer USDC from player's token account to escrow
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player_token_account.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, game.buy_in)?;

        game.players.push(PlayerState {
            pubkey: player_pubkey,
            x: start_x,
            y: start_y,
            alive: true,
        });
        game.prize_pool = game.prize_pool.checked_add(game.buy_in).unwrap();

        // Auto-activate if game has players (for MVP; in prod use max_players)
        if game.players.len() >= 2 {
            game.status = 1; // active
        }

        Ok(())
    }

    /// Player submits a move. Authority co-signs to validate server-side logic.
    pub fn submit_move(
        ctx: Context<SubmitMove>,
        _game_id: [u8; 16],
        new_x: u8,
        new_y: u8,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game_state;

        require!(game.status == 1, IgniteError::GameNotActive);

        let player_key = ctx.accounts.player.key();
        let player_state = game
            .players
            .iter_mut()
            .find(|p| p.pubkey == player_key)
            .ok_or(IgniteError::PlayerNotInGame)?;

        require!(player_state.alive, IgniteError::PlayerEliminated);

        // Validate adjacency (Manhattan distance of 1)
        let dx = (new_x as i16 - player_state.x as i16).abs();
        let dy = (new_y as i16 - player_state.y as i16).abs();
        require!(dx + dy == 1, IgniteError::InvalidMove);

        // Validate tile is safe
        let tile_idx = (new_y as usize) * (game.grid_size as usize) + (new_x as usize);
        require!(tile_idx < game.grid.len(), IgniteError::OutOfBounds);
        require!(game.grid[tile_idx] == 0, IgniteError::TileIsLava);

        player_state.x = new_x;
        player_state.y = new_y;

        Ok(())
    }

    /// Authority-only: collapse specified tiles and eliminate players on them.
    pub fn trigger_collapse(
        ctx: Context<TriggerCollapse>,
        _game_id: [u8; 16],
        tiles: Vec<(u8, u8)>,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game_state;
        require!(game.status == 1, IgniteError::GameNotActive);

        for (tx, ty) in &tiles {
            let idx = (*ty as usize) * (game.grid_size as usize) + (*tx as usize);
            if idx < game.grid.len() {
                game.grid[idx] = 1; // lava
            }
        }

        // Eliminate players on lava tiles
        for p in game.players.iter_mut() {
            if p.alive {
                let idx = (p.y as usize) * (game.grid_size as usize) + (p.x as usize);
                if game.grid[idx] == 1 {
                    p.alive = false;
                }
            }
        }

        game.collapse_round = game.collapse_round.checked_add(1).unwrap();

        Ok(())
    }

    /// Authority-only: declare winner and release escrow to winner's ATA.
    pub fn declare_winner(ctx: Context<DeclareWinner>, game_id: [u8; 16]) -> Result<()> {
        let game = &mut ctx.accounts.game_state;
        require!(game.status == 1, IgniteError::GameNotActive);

        let alive: Vec<&PlayerState> = game.players.iter().filter(|p| p.alive).collect();
        require!(alive.len() == 1, IgniteError::GameNotResolved);

        let winner_pubkey = alive[0].pubkey;
        game.winner = Some(winner_pubkey);
        game.status = 2; // resolved

        // Transfer escrow to winner's token account
        let seeds = &[
            b"escrow".as_ref(),
            &game_id,
            &[ctx.bumps.escrow_vault],
        ];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.winner_token_account.to_account_info(),
                authority: ctx.accounts.escrow_vault.to_account_info(),
            },
            signer,
        );
        token::transfer(transfer_ctx, game.prize_pool)?;
        game.prize_pool = 0;

        Ok(())
    }
}

// ─── Account Structs ──────────────────────────────────────────────────────────

#[account]
pub struct GameState {
    pub game_id: [u8; 16],
    pub authority: Pubkey,
    pub status: u8,            // 0=waiting 1=active 2=resolved
    pub grid_size: u8,
    pub grid: Vec<u8>,         // flattened grid, 0=safe 1=lava (max 100)
    pub players: Vec<PlayerState>,
    pub buy_in: u64,
    pub prize_pool: u64,
    pub winner: Option<Pubkey>,
    pub created_at: i64,
    pub collapse_round: u8,
}

impl GameState {
    // 8 (discriminator) + 16 + 32 + 1 + 1
    // + (4 + MAX_GRID_TILES) + (4 + MAX_PLAYERS * PlayerState::SIZE)
    // + 8 + 8 + (1 + 32) + 8 + 1 = ~580 bytes → use 1024 for headroom
    pub const SIZE: usize = 1024;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PlayerState {
    pub pubkey: Pubkey, // 32
    pub x: u8,         //  1
    pub y: u8,         //  1
    pub alive: bool,   //  1
                       // = 35 bytes each
}

impl PlayerState {
    pub const SIZE: usize = 35;
}

// ─── Contexts ─────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(game_id: [u8; 16])]
pub struct InitializeGame<'info> {
    #[account(
        init,
        payer = authority,
        space = GameState::SIZE,
        seeds = [b"game_state", &game_id],
        bump
    )]
    pub game_state: Account<'info, GameState>,

    /// CHECK: escrow vault is a token account managed separately
    #[account(
        seeds = [b"escrow", &game_id],
        bump
    )]
    pub escrow_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: [u8; 16])]
pub struct JoinGame<'info> {
    #[account(
        mut,
        seeds = [b"game_state", &game_id],
        bump
    )]
    pub game_state: Account<'info, GameState>,

    #[account(
        mut,
        seeds = [b"escrow", &game_id],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub player_token_account: Account<'info, TokenAccount>,

    pub player: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(game_id: [u8; 16])]
pub struct SubmitMove<'info> {
    #[account(
        mut,
        seeds = [b"game_state", &game_id],
        bump
    )]
    pub game_state: Account<'info, GameState>,

    pub player: Signer<'info>,

    /// Authority co-signs to validate server-side move logic
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(game_id: [u8; 16])]
pub struct TriggerCollapse<'info> {
    #[account(
        mut,
        seeds = [b"game_state", &game_id],
        bump,
        has_one = authority
    )]
    pub game_state: Account<'info, GameState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(game_id: [u8; 16])]
pub struct DeclareWinner<'info> {
    #[account(
        mut,
        seeds = [b"game_state", &game_id],
        bump,
        has_one = authority
    )]
    pub game_state: Account<'info, GameState>,

    #[account(
        mut,
        seeds = [b"escrow", &game_id],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub winner_token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ─── Errors ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum IgniteError {
    #[msg("Invalid grid size — maximum is 10.")]
    InvalidGridSize,
    #[msg("Game is not in waiting status.")]
    GameNotJoinable,
    #[msg("Game is full.")]
    GameFull,
    #[msg("Game is not active.")]
    GameNotActive,
    #[msg("Tile coordinates are out of bounds.")]
    OutOfBounds,
    #[msg("That tile has turned to lava.")]
    TileIsLava,
    #[msg("That tile is already occupied by another player.")]
    TileOccupied,
    #[msg("Player is not in this game.")]
    PlayerNotInGame,
    #[msg("Player has already been eliminated.")]
    PlayerEliminated,
    #[msg("Move must be exactly one tile in a cardinal direction.")]
    InvalidMove,
    #[msg("Game has not resolved to exactly one survivor yet.")]
    GameNotResolved,
}
