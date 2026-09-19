/**
 * A job that repeats only while somebody can actually see the page.
 *
 * Every page here polls: the board asks for the whole board once a second, the file viewer asks
 * git what changed every three. None of them ever asked whether anyone was looking, so a tab left
 * open in another window went on asking for days. That is worse than it sounds, because asking is
 * itself the signal: `/api/board` is what tells the server somebody is watching, and the server
 * uses that to decide whether to sample the machine, walk the process table and ask git about
 * every repository. One forgotten tab kept all of it running, for nothing.
 *
 * Coming back runs the job at once, before the interval starts again — the first look at a tab you
 * left yesterday must not show yesterday. The first start is left alone: pages that want a reading
 * before the first interval already take it themselves.
 *
 * Gives back the way to stop it for good, which nothing needs yet and costs one line to offer.
 */
export function whileVisible(job, every) {
  let timer = null

  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }

  const start = () => {
    if (!timer) timer = setInterval(job, every)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return stop()
    job()
    start()
  })

  // A page opened in a background tab is hidden from the first frame: it should not start either.
  if (!document.hidden) start()

  return stop
}
