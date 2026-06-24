-- Atomic GCRA (Generic Cell Rate Algorithm) — leaky bucket as a *meter*.
-- A single stored value, the Theoretical Arrival Time (TAT), encodes the whole
-- state: how far "ahead of schedule" the client is. Admit a request only if it
-- wouldn't push the schedule more than `tau` (the burst tolerance) past now.
-- KEYS[1] = gcra:{client}
-- ARGV[1] = rate (req/sec)
-- ARGV[2] = burst (requests allowed in a clump)
-- ARGV[3] = now (epoch seconds, float)
-- ARGV[4] = cost (requests this one counts as; usually 1)
-- Returns { allowed (0/1), tat_string }
local rate  = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now   = tonumber(ARGV[3])
local cost  = tonumber(ARGV[4]) or 1

local T   = 1.0 / rate     -- emission interval (seconds per request)
local tau = burst * T      -- burst tolerance: how far ahead of `now` the TAT may sit

local tat = tonumber(redis.call('GET', KEYS[1])) or now
if tat < now then tat = now end

local new_tat = tat + T * cost
local allowed = 0
if (new_tat - now) <= tau then
  allowed = 1
  tat = new_tat
  redis.call('SET', KEYS[1], tat)
  redis.call('EXPIRE', KEYS[1], math.ceil(tau) + 1)  -- key drains, then self-expires
end

return { allowed, tostring(tat) }
