CREATE INDEX personal_bests_ranking ON personal_bests(mode, ticks, achieved_at, user_id);
CREATE INDEX users_rating_ranking ON users(rating DESC, id) WHERE kind = 'member';
