$(function () {
  let localStream;
  let pc1;
  let pc2;
  let localVideo = $('#local-video')[0];
  let remoteVideo = $('#remote-video')[0];
  let hostname = 'hostname';
  let app = 'app';
  let stream = 'stream';
  let nodesUrl = `https://${hostname}/v1/webrtc/getnodes/${app}/${stream}/`

  $('#publish').click(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      console.warn('Received local stream');
      localVideo.srcObject = stream;
      localStream = stream;
      $('#connect')[0].disabled = false;

      publish();
    } catch (e) {
      alert(`getUserMedia error: ${e.name}`)
    }
  })

  $('#play').click(async function () {
    play ();
    $('#play')[0].disabled = true;
  })

  async function publish() {
    console.warn(new Date().getTime() + ' starting publish');

    pc1 = new RTCPeerConnection();
    pc1.addEventListener('icecandidate', e => onIceCandidate('pc1', e));
    pc1.addEventListener('iceconnectionstatechange', e => onIceStateChange('pc1', e));

    localStream.getTracks().forEach(track => pc1.addTrack(track, localStream));

    try {
      console.warn('publish createOffer start');
      const offer = await pc1.createOffer({
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 1
      })
      await onCreateOfferSuccess(pc1, offer)
    } catch (err) {
      onCreateSessionDescriptionError(err);
    }
  }

  async function play() {
    console.warn(new Date().getTime() + ' starting playing');

    pc2 = new RTCPeerConnection();
    pc2.addEventListener('icecandidate', e => onIceCandidate('pc2', e));
    pc2.addEventListener('iceconnectionstatechange', e => onIceStateChange('pc2', e));
    pc2.addEventListener('track', gotRemoteStream);

    try {
      console.warn('play createOffer start');
      const offer = await pc2.createOffer({
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 1
      })
      await onCreateOfferSuccess(pc2,offer)
    } catch (err) {
      onCreateSessionDescriptionError(err);
    }
  }

  async function onCreateOfferSuccess(pc,desc) {
    console.warn(`Offer from ${getName(pc)}\n${desc.sdp}`);
    console.log(`${getName(pc)} setLocalDescription start`);
    try {
      await pc.setLocalDescription(desc);
      onSetLocalSuccess(getName(pc), desc);
    } catch (e) {
      onSetSessionDescriptionError(e);
    }
  }

  async function onIceCandidate(pc, event) {
    // try {
    //   await (getOtherPc(pc).addIceCandidate(event.candidate));
    //   onAddIceCandidateSuccess(pc);
    // } catch (e) {
    //   onAddIceCandidateError(pc, e);
    // }
    console.log(`${pc} ICE candidate:\n${event.candidate ? event.candidate.candidate : '(null)'}`);
  }

  function onIceStateChange(pc, event) {
    if (pc) {
      console.log(`${pc} ICE state: ${pc.iceConnectionState}`);
      console.log('ICE state change event: ', event);
    }
  }

  function gotRemoteStream(e) {
    if (remoteVideo.srcObject !== e.streams[0]) {
      remoteVideo.srcObject = e.streams[0];
      console.log('pc2 received remote stream');
    }
  }

  function onSetLocalSuccess(pc, desc) {
    console.log(`${getName(pc)} setLocalDescription complete`);
    console.warn(`${getName(pc)} start getnodes`)

    $.post(nodesUrl + (getName(pc) == 'pc1'? 'publish': 'play'), {
      offer: {
        sdp: desc
      }
    }, res => {
      let data = res.data
      if (data.code == 0) {
        let answer = data.data.answer;
        let sdp = answer.sdp;

        let answerDescription = {
          type: 'answer',
          sdp: sdp,
          toJSON: () => { }
        }

        console.warn(getName(pc) + ' start set remote sdp')
        pc.setRemoteDescription(new RTCSessionDescription(answerDescription)).then(() => {
          console.warn(getName(pc) + ' set remote success');

        }, err => {
          console.error(getName(pc) + ' set remote fail ' + err);
        })
        nodes = data.data.nodes;
      } else if (data.code !== 0) {
        console.error('get nodes fail ' + data.message)
      }
    }, 'json')
  }

  function onSetSessionDescriptionError(error) {
    console.log(`Failed to set session description: ${error.toString()}`);
  }

  function onCreateSessionDescriptionError(error) {
    console.log(`Failed to create session description: ${error.toString()}`);
  }

  function getName(pc) {
    return (pc === pc1) ? 'pc1' : 'pc2';
  }

  // function onAddIceCandidateError(pc, error) {
  //   console.log(`${pc} failed to add ICE Candidate: ${error.toString()}`);
  // }


})