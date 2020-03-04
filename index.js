$(function () {
  let localStream;
  let pc1; //推流
  let pc2; //拉流
  let localVideo = $('#local-video')[0];
  let remoteVideo = $('#remote-video')[0];
  let hostname = $('#hostname').val();
  let app = $('#app').val();
  let stream = $('#stream').val();
  let nodesUrl = `https://${hostname}/v1/webrtc/getnodes/${app}/${stream}/`;
  let localSdpRevert = false;  // 部分浏览器 video和audio顺序是反过来的
  let videoDecodeType = $('#videoCodeType').val() || 'H264';
  let audioBitRate = $('#audioBitrate').val() * 1 || 48000;


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
    localSdpRevert = false;
    play();
    // $('#play')[0].disabled = true;
  })

  async function publish() {
    console.warn(new Date().getTime() + ' starting publish');

    pc1 = new RTCPeerConnection();
    pc1.addEventListener('icecandidate', e => onIceCandidate('pc1', e));
    pc1.addEventListener('iceconnectionstatechange', e => onIceStateChange(pc1, e));

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
    pc2.addEventListener('iceconnectionstatechange', e => onIceStateChange(pc2, e));
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

    desc.sdp = desc.sdp.replace(/sendrecv/g, getName(pc) ? 'sendonly' : 'recvonly');
    getName(pc) == 'pc1' && (desc.sdp = desc.sdp.replace(/useinbandfec=\d+/, 'maxaveragebitrate=' + audioBitRate));

    getName(pc) == 'pc1' && /m=video[\s\S]*m=audio/.test(desc.sdp) && (localSdpRevert = true);

    desc.sdp = getSDPByVideDecodeType (desc.sdp, videoDecodeType);

    try {
      await pc.setLocalDescription(desc);
      onSetLocalDescriptionSuccess(pc, desc);
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
      console.warn(`${getName(pc)} ICE state: ${pc.iceConnectionState}`);
      console.log('ICE state change event: ', event);
    }
  }

  function gotRemoteStream(e) {
    if (remoteVideo.srcObject !== e.streams[0]) {
      remoteVideo.srcObject = e.streams[0];
      console.warn('pc2 received remote stream');
    }
  }

  function onSetLocalDescriptionSuccess(pc, desc) {
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
      let sdp = (answer && answer.sdp) ? answer.sdp : undefined;
      let nodes = data.nodes;
      let serverdata = res.serverdata;
      //sendKeyNodes(pc, nodes[0].key, desc, serverdata);

      if (!sdp) {
        console.warn('no found sdp, use keynodes');
        sendKeyNodes(pc, nodes[0].key, desc, serverdata);
        return;
      }

      onGetRemoteOfferSucceses(pc, sdp)

    } else if (data.code !== 0) {
      console.error('get nodes fail ' + data.message)
    }
  }

  function sendKeyNodes(pc, key, desc, serverdata) {
    let keyNodesUrl = `https://${key}/v1/webrtc/sdp/${app}/${stream}/`
    $.ajax({
      type: 'POST',
      url: keyNodesUrl + (getName(pc) == 'pc1' ? 'publish' : 'play'),
      crossDomain: true,
      data: JSON.stringify({
        node_key: key,
        offer: {
          sdp: desc.sdp
        },
        serverdata: serverdata
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
      let sdp = (answer && answer.sdp) ? answer.sdp : undefined;

      onGetRemoteOfferSucceses(pc, sdp)
    } else {
      console.error(`get sdp fail reason ${res.code} ${res.message}`);
    }
  }

  function onGetRemoteOfferSucceses(pc, sdp) {
    if (localSdpRevert) {

      let [headerSdp, videoSdp, audioSdp] = [
        /[\s\S]*m=audio/.exec(sdp)[0].replace('m=audio', ''),
        /m=video[\s\S]*/.exec(sdp)[0],
        /m=audio[\s\S]*m=video/.exec(sdp)[0].replace('m=video', ''),
      ];

      let mids = /a=group:BUNDLE\s+(\w+)\s+(\w+)/.exec(headerSdp);

      headerSdp = headerSdp.replace(/a=group:BUNDLE\s+(\w+)\s+(\w+)/, 'a=group:BUNDLE ' + mids[2] + ' ' + mids[1]);

      sdp = headerSdp + videoSdp + audioSdp;
      console.log('remoteSdp:', sdp);
    }


    let answerDescription = {
      type: 'answer',
      sdp: sdp,
      toJSON: () => { }
    }

    console.warn(getName(pc) + ' start set remote sdp');

    pc.setRemoteDescription(new RTCSessionDescription(answerDescription)).then(() => {
      console.warn(getName(pc) + ' set remote sdp success');

    }, err => {
      console.error(getName(pc) + ' set remote fail ' + err);

    })
  }

  function getSDPByVideDecodeType(sdp, type) {
    let videoDecodeTypes = {
      str: '',
      arr: [],
      obj: {
        'H264': [],
        'H265': [],
        'VP8': [],
        'VP9': [],
        'OHTER': [],
      }
    }

    if (!sdp.includes('m=video')) {
      return sdp;
    }

    let videoHead = /m=video.+/.exec(sdp)[0];
    videoHead = videoHead.match(/[\s|\d]+/g)[1].replace(' ', '')

    videoDecodeTypes.str = videoHead;
    videoDecodeTypes.arr = videoDecodeTypes.str.split(' ');
    videoDecodeTypes.arr.forEach(decodeType => {
      let reg = new RegExp('a=rtpmap:' + decodeType + '.+');
      let matched = reg.exec(sdp)[0];
      if (matched.includes('H264')) {
        videoDecodeTypes.obj.H264.push(decodeType);
      } else if (matched.includes('H265')) {
        videoDecodeTypes.obj.H265.push(decodeType);
      } else if (matched.includes('VP8')) {
        videoDecodeTypes.obj.VP8.push(decodeType);
      } else if (matched.includes('VP9')) {
        videoDecodeTypes.obj.VP9.push(decodeType);
      } else {
        videoDecodeTypes.obj.OHTER.push(decodeType);
      }
    });


    videoDecodeTypes.obj.OHTER.forEach(otherType => {
      let reg = new RegExp('a=fmtp:' + otherType + '.+apt=(\\d+)');
      let matchedArr = reg.exec(sdp);
      let matched = matchedArr && matchedArr[1];
      if (matched) {
        if (videoDecodeTypes.obj.H264.includes(matched)) {
          videoDecodeTypes.obj.H264.push(otherType);
        } else if (videoDecodeTypes.obj.H265.includes(matched)) {
          videoDecodeTypes.obj.H265.push(otherType);
        } else if (videoDecodeTypes.obj.VP8.includes(matched)) {
          videoDecodeTypes.obj.VP8.push(otherType);
        } else if (videoDecodeTypes.obj.VP9.includes(matched)) {
          videoDecodeTypes.obj.VP9.push(otherType);
        }
      }
    });

    let targetArr = [];
    if (type === 'VP9') {
      targetArr = [
        // ...videoDecodeTypes.obj.OHTER,
        ...videoDecodeTypes.obj.H265,
        ...videoDecodeTypes.obj.H264,
        ...videoDecodeTypes.obj.VP8,
      ];
    } else if (type === 'VP8') {
      targetArr = [
        // ...videoDecodeTypes.obj.OHTER,
        ...videoDecodeTypes.obj.H265,
        ...videoDecodeTypes.obj.H264,
        ...videoDecodeTypes.obj.VP9,
      ];
    } else if (type === 'H264') {
      targetArr = [
        // ...videoDecodeTypes.obj.OHTER,
        ...videoDecodeTypes.obj.H265,
        ...videoDecodeTypes.obj.VP8,
        ...videoDecodeTypes.obj.VP9,
      ];
    } else if (type === 'H265') {
      targetArr = [
        //...videoDecodeTypes.obj.OHTER,
        ...videoDecodeTypes.obj.VP8,
        ...videoDecodeTypes.obj.H264,
        ...videoDecodeTypes.obj.VP9,
      ];
    }

    // targetArr.forEach(itype => {
    //         let currentIndex = videoDecodeTypes.arr.indexOf(itype);
    //         let reg;
    //         if( currentIndex!==(videoDecodeTypes.arr.length - 1)){
    //                 reg = new RegExp('a=rtpmap:' + itype + '[\\s\\S]+a=rtpmap:' + videoDecodeTypes.arr[currentIndex+1])
    //                 sdp = sdp.replace(reg, 'a=rtpmap:' + videoDecodeTypes.arr[currentIndex+1]);
    //         }else{
    //                 reg = new RegExp ('a=rtpmap:' + itype + '[\\s\\S]+a=fmtp:' + itype + '.+\\s\\n')
    //                 sdp = sdp.replace(reg, '');
    //         }
    //         videoDecodeTypes.arr.splice(currentIndex,1)
    //         //console.log('targetArr',reg)
    // });

    targetArr.forEach(itype => {
      let currentIndex = videoDecodeTypes.arr.indexOf(itype);
      videoDecodeTypes.arr.splice(currentIndex, 1);

      let regRtpmap = new RegExp('a=rtpmap:' + itype + '.+\\s\\n', 'g');
      let regRtcpfb = new RegExp('a=rtcp-fb:' + itype + '.+\\s\\n', 'g');
      let regFmtp = new RegExp('a=fmtp:' + itype + '.+\\s\\n', 'g');

      sdp = sdp.replace(regRtpmap, '');
      sdp = sdp.replace(regRtcpfb, '');
      sdp = sdp.replace(regFmtp, '');
    });

    sdp = sdp.replace(videoHead, videoDecodeTypes.arr.join(' '))
    return sdp;
  }

  function getName(pc) {
    return (pc === pc1) ? 'pc1' : 'pc2';
  }

  // function onAddIceCandidateError(pc, error) {
  //   console.log(`${pc} failed to add ICE Candidate: ${error.toString()}`);
  // }


})