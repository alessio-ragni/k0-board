// How many rounds in a row have to say "nothing moved" before the page stops asking so often.
// Five is about ten seconds of a still board, which is long enough that nobody is watching it
// happen and short enough that the slow pace is rarely the one you arrive back to.
const QUIET = 5

/**
 * A job that repeats only while somebody can see the page, and only as often as it is worth.
 *
 * Every page here polls: the board asks for the whole board, the file viewer asks git what
 * changed. None of them ever asked whether anyone was looking, so a tab left open in another
 * window went on asking for days. That is worse than it sounds, because asking is itself the
 * signal: `/api/board` is what tells the server somebody is watching, and the server uses that to
 * decide whether to sample the machine, walk the process table and ask git about every repository.
 * One forgotten tab kept all of it running, for nothing.
 *
 * And a job may now say that nothing moved, by answering `false`. After a few such rounds the
 * page drops to `resting`, and the first round that moves anything — or your coming back to the
 * tab — puts it straight back. A job that says nothing at all is taken to have moved something,
 * which is the safe way round: a page that does not know cannot be the one that goes quiet.
 *
 * Coming back runs the job at once — the first look at a tab you left yesterday must not show
 * yesterday. The first start is left alone: pages that want a reading before the first interval
 * already take it themselves.
 *
 * Gives back the way to stop it for good, which nothing needs yet and costs one line to offer.
 */
export function whileVisible(job, every, resting = every) {
  let timer = null
  let quiet = 0

  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const arm = (ms) => {
    stop()
    timer = setTimeout(round, ms)
  }

  async function round() {
    let moved = true
    try {
      moved = await job()
    } catch {
      /* the job fell over: it has told us nothing, so keep the working pace and try again */
    }
    quiet = moved === false ? quiet + 1 : 0
    arm(quiet >= QUIET ? resting : every)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return stop()
    quiet = 0
    round()
  })

  // A page opened in a background tab is hidden from the first frame: it should not start either.
  if (!document.hidden) arm(every)

  return stop
}
