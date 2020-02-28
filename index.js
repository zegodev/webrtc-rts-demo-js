$(function () {
  let localStream;
  let pc1;
  let pc2;
  let localVideo = $('#local-video')[0];
  let remoteVideo = $('#remote-video')[0];
  let hostname = 'udpdispatch-test.zego.im';
  let app = 'vincentapp';
  let stream = 'teststream_vincent';
  let nodesUrl = `https://${hostname}/v1/webrtc/getnodes/${app}/${stream}/`
  let keyNodesUrl = `https://${hostname}/v1/webrtc/sdp/${app}/${stream}/`


  $('#publish').click(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      console.warn('Received local stream');
      localVideo.srcObject = stream;
      localStream = stream;
      $('#play')[0].disabled = false;

      publish();
    } catch (e) {
      alert(`getUserMedia error: ${e.name}`)
    }
  })

  $('#play').click(async function () {
    play();
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
      await onCreateOfferSuccess(pc2, offer)
    } catch (err) {
      onCreateSessionDescriptionError(err);
    }
  }

  async function onCreateOfferSuccess(pc, desc) {
    console.log(`Offer from ${getName(pc)}\n${desc.sdp}`);
    console.log(`${getName(pc)} setLocalDescription start`);
    try {
      await pc.setLocalDescription(desc);
      onSetLocalSuccess(pc, desc);
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

    $.ajax({
      type: 'post',
      url: nodesUrl + (getName(pc) == 'pc1' ? 'publish' : 'play'),
      data: JSON.stringify({
        offer: {
          sdp: desc.sdp
        }
      }),
      success: res => {
        console.warn('getnodes success')
        handleNodesRsp(pc, res, desc);
      },
      contentType: "application/json",
      dataType: 'json'
    })
  }

  function onSetSessionDescriptionError(error) {
    console.log(`Failed to set session description: ${error.toString()}`);
  }

  function onCreateSessionDescriptionError(error) {
    console.log(`Failed to create session description: ${error.toString()}`);
  }

  function handleNodesRsp(pc, res, desc) {

    if (res.code == 0) {
      let data = res.data
      let answer = data.answer;
      let sdp = (answer && answer.sdp)? answer.sdp: undefined;
      let nodes = data.nodes;
      let serverdata = res.serverdata;

      if (!sdp) {
        console.warn('no found sdp, use keynodes');
        sendKeyNodes(pc, nodes[0].key, desc, serverdata);
        return;
      }

      handleRemoteSDP (pc, sdp)

    } else if (data.code !== 0) {
      console.error('get nodes fail ' + data.message)
    }
  }

  function sendKeyNodes(pc, key, desc, serverdata) {
    $.ajax({
      type: 'POST',
      url: keyNodesUrl + (getName(pc) == 'pc1' ? 'publish' : 'play'),
      crossDomain: true,
      data: JSON.stringify({
        offer: {
          node_key: key,
          sdp: desc.sdp,
          serverdata: serverdata
        }
      }),
      success: res => {
        console.warn('getnodes success')
        handleKeyNodesRsp(pc, res);
      },
      contentType: 'application/json',
      dataType: 'json'
    })
  }

  function handleKeyNodesRsp(pc, res) {
    if (res.code == 0) {
      let data = res.data
      let answer = data.answer;
      let sdp = (answer && answer.sdp)? answer.sdp: undefined;
    } else {
      console.err (`get sdp fail ${res.code} ${res.message}`);
    }
  }

  function handleRemoteSDP (pc, sdp) {
    let answerDescription = {
      type: 'answer',
      sdp: sdp,
      toJSON: () => { }
    }

    console.warn(getName(pc) + ' start set remote sdp');

    pc.setRemoteDescription(new RTCSessionDescription(answerDescription)).then(() => {
      console.warn(getName(pc) + ' set remote success');

    }, err => {
      console.error(getName(pc) + ' set remote fail ' + err);

    })
  }

  function getName(pc) {
    return (pc === pc1) ? 'pc1' : 'pc2';
  }

  // function onAddIceCandidateError(pc, error) {
  //   console.log(`${pc} failed to add ICE Candidate: ${error.toString()}`);
  // }


})