/* Behaviour shared by the install guide and the agent guide.
   Inlined into the standalone single-file build, so it stays dependency-free. */
(function () {
  // 时间线：滚过第几步，圆点与连线就填到第几步。
  var items = Array.prototype.slice.call(document.querySelectorAll('.tl li'))
  if (items.length) {
    var steps = items.map(function (li) { return document.getElementById(li.dataset.step) })

    function paint() {
      var line = window.scrollY + window.innerHeight * 0.34
      var active = 0
      for (var i = 0; i < steps.length; i += 1) {
        if (steps[i] && steps[i].offsetTop <= line) active = i
      }
      items.forEach(function (li, i) {
        li.classList.toggle('done', i <= active)
        li.classList.toggle('now', i === active)
      })
    }

    var queued = false
    window.addEventListener('scroll', function () {
      if (queued) return
      queued = true
      requestAnimationFrame(function () { queued = false; paint() })
    }, { passive: true })
    window.addEventListener('resize', paint)
    paint()
  }

  // 复制：真的复制，失败就选中让人手动复制。
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var block = btn.parentElement.querySelector('pre.copy')
      var text = block ? block.textContent : ''
      function ok() {
        var old = btn.textContent
        btn.textContent = '已复制'
        btn.setAttribute('data-done', '1')
        setTimeout(function () { btn.textContent = old; btn.removeAttribute('data-done') }, 1800)
      }
      function fallback() {
        if (!block) return
        var range = document.createRange()
        range.selectNodeContents(block)
        var sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        ok()
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, fallback)
      } else {
        fallback()
      }
    })
  })
})()
