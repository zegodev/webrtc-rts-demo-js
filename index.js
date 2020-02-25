$(function () {

  $('#start').click(async function () {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true,video: true});
      console.warn('Received local stream');
      $()
    } catch (e) {
      alert(`getUserMedia error: ${e.name}`)
    }

  })
})