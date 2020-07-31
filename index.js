let videoDecodeType, audioBitRate, hostname, streamName, app, stream, auth, key;

// type: 'publish' || 'play'
const getNodeUrl = ({hostname = '', type = 'publish', app, stream}) =>
  `https://${hostname}/v1/webrtc/getnodes/${app}/${stream}/${type}`;

// type: 'publish' || 'play'
const getRemoteUrl = ({hostname = '', type = 'publish', app, stream}) =>
  `https://${hostname}/v1/webrtc/sdp/${app}/${stream}/${type}`;

const RTCOfferOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 1,
};

let $localVideo = $('#local-video').get(0);
let $remoteVideo = $('#remote-video').get(0);

$('#publish').click(async () => {
  try {
    videoDecodeType = $('#videoCodeType').val();
    audioBitRate = parseInt($('#audioBitrate').val(), 10);
    hostname = $('#hostname').val();
    streamName = $('#stream').val();
    app = $('#app').val();
    auth = $('#auth').prop('checked');
    key = $('#key').val();

    if (auth && !key.trim()) {
      return alert('请输入 key');
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    $localVideo.srcObject = stream;

    try {
      const pc = createPC();
      // ! addTrack before createOffer
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer(RTCOfferOptions);

      const type = 'publish';
      const formattedOffer = formatOffer(offer, type);
      await handlePC(pc, formattedOffer, type);
    } catch (e) {
      errorHandle('createOffer', e);
    }
  } catch (e) {
    errorHandle('getUserMedia', e);
  }
});

$('#play').click(async function () {
  try {
    const pc = createPC();

    pc.addEventListener('track', (e) => {
      // run twice
      if ($remoteVideo.srcObject !== e.streams[0]) {
        $remoteVideo.srcObject = e.streams[0];
      }
    });

    const offer = await pc.createOffer(RTCOfferOptions);
    const type = 'play';
    const formattedOffer = formatOffer(offer, type);
    await handlePC(pc, formattedOffer, type);
  } catch (e) {
    errorHandle('createOffer', e);
  }
});

$('#stop').click(function () {
  stream.getTracks().forEach((track) => track.stop());
});

$('#auth').click(function () {
  const $formKey = $('#form-key');
  if ($(this).prop('checked')) {
    $formKey.removeClass('d-none');
  } else {
    $formKey.addClass('d-none');
  }
});

function createPC() {
  const pc = new RTCPeerConnection();
  pc.addEventListener('icecandidate', onIceCandidate);
  pc.addEventListener('iceconnectionstatechange', (e) =>
    onIceStateChange(pc, e)
  );
  return pc;
}

function formatOffer(offer, type = 'publish') {
  offer.sdp = offer.sdp.replace(/sendrecv/g, 'sendonly');
  if (type === 'publish') {
    offer.sdp = offer.sdp.replace(
      /useinbandfec=\d+/,
      'maxaveragebitrate=' + audioBitRate
    );
  }

  offer.sdp = formatSdpByDecodeType(offer.sdp, videoDecodeType);
  return offer;
}

// type: 'publish' || 'play';
async function handlePC(pc, offer, type) {
  try {
    await pc.setLocalDescription(offer);

    const getNodesUrl = getNodeUrl({
      hostname,
      type,
      app,
      stream: streamName,
    });
    let getNodesData = {
      offer: {
        sdp: offer.sdp,
      },
    };
    if (auth) {
      getNodesData = useSign(getNodesData, type);
    }
    // 调取服务端接口获取 node 节点
    const {
      data: {nodes},
      serverdata,
    } = await ajaxPost(getNodesUrl, getNodesData);
    log('nodes', nodes);

    let count = 0,
      length = nodes.length;
    if (!length) {
      log('nodes', '没有可用的 IP');
      return;
    }

    while (nodes.length) {
      count++;
      const ip = nodes.shift().key;
      log('IP', ip);

      const remoteUrl = getRemoteUrl({
        hostname: ip,
        type,
        app,
        stream: streamName,
      });
      let getRemoteUrlData = {
        node_key: ip,
        offer: {
          sdp: offer.sdp,
        },
        serverdata,
      };
      if (auth) {
        getRemoteUrlData = useSign(getRemoteUrlData, type);
      }
      // 调取服务端接口获取 remoteDescription
      const {data: remoteDescription} = await ajaxPost(
        remoteUrl,
        getRemoteUrlData
      );
      log('remoteDescription', remoteDescription);

      const answerDescription = {
        type: 'answer',
        sdp: remoteDescription.answer.sdp,
        toJSON: () => {},
      };
      log('answerDescription', answerDescription);

      try {
        await pc.setRemoteDescription(
          new RTCSessionDescription(answerDescription)
        );
        log('setRemoteDescription', 'setRemoteDescription success');
        break;
      } catch (e) {
        errorHandle('setRemoteDescription', e);
      }
    }

    if (count === length) {
      log('GG', '所有 IP 都已尝试失败');
    }
  } catch (e) {
    errorHandle('setLocalDescription', e);
  }
  return pc;
}

function onIceCandidate(event) {
  log('ICE candidate', event.candidate ? event.candidate.candidate : null);
}

function onIceStateChange(pc, event) {
  log('ICE state', pc.iceConnectionState);
  log('ICE state change event', event);
}

function formatSdpByDecodeType(sdp, type) {
  const H264 = [];
  const H265 = [];
  const VP8 = [];
  const VP9 = [];
  const OHTER = [];
  const videoSdp = /m=video.+/.exec(sdp)[0];
  const videoHead = videoSdp.match(/[\s|\d]+/g)[1].replace(' ', '');
  const videoDecodeTypesArr = videoHead.split(' ');

  videoDecodeTypesArr.forEach((decodeType) => {
    let reg = new RegExp('a=rtpmap:' + decodeType + '.+');
    let matched = reg.exec(sdp)[0];
    if (matched.includes('H264')) {
      H264.push(decodeType);
    } else if (matched.includes('H265')) {
      H265.push(decodeType);
    } else if (matched.includes('VP8')) {
      VP8.push(decodeType);
    } else if (matched.includes('VP9')) {
      VP9.push(decodeType);
    } else {
      OHTER.push(decodeType);
    }
  });

  OHTER.forEach((otherType) => {
    let reg = new RegExp('a=fmtp:' + otherType + '.+apt=(\\d+)');
    let matchedArr = reg.exec(sdp);
    let matched = matchedArr && matchedArr[1];
    if (matched) {
      if (H264.includes(matched)) {
        H264.push(otherType);
      } else if (H265.includes(matched)) {
        H265.push(otherType);
      } else if (VP8.includes(matched)) {
        VP8.push(otherType);
      } else if (VP9.includes(matched)) {
        VP9.push(otherType);
      }
    }
  });

  let targetArr = [];
  if (type === 'VP9') {
    targetArr = [].concat(H265, H264, VP8);
  } else if (type === 'VP8') {
    targetArr = [].concat(H265, H264, VP9);
  } else if (type === 'H264') {
    targetArr = [].concat(H265, VP8, VP9);
  } else if (type === 'H265') {
    targetArr = [].concat(VP8, H264, VP9);
  }

  targetArr.forEach((itype) => {
    let currentIndex = videoDecodeTypesArr.indexOf(itype);
    videoDecodeTypesArr.splice(currentIndex, 1);

    let regRtpmap = new RegExp('a=rtpmap:' + itype + '.+\\s\\n', 'g');
    let regRtcpfb = new RegExp('a=rtcp-fb:' + itype + '.+\\s\\n', 'g');
    let regFmtp = new RegExp('a=fmtp:' + itype + '.+\\s\\n', 'g');

    sdp = sdp.replace(regRtpmap, '');
    sdp = sdp.replace(regRtcpfb, '');
    sdp = sdp.replace(regFmtp, '');
  });

  return sdp.replace(videoHead, videoDecodeTypesArr.join(' '));
}

function useSign(data, type) {
  const time = Date.now();
  const nonce = (Date.now() + Math.random()).toString(32);
  const paramData = {
    ...data,

    time,
    nonce,

    app,
    stream: streamName,
    type,
  };
  let signStr, sign;
  // !offer 取 sdp 的值
  paramData.offer = paramData.offer.sdp;
  signStr = normalizeParams(paramData) + `&key=${key}`;
  log('get sign string', signStr);
  sign = md5(signStr);
  log('sign', sign);

  return {
    ...data,
    time,
    nonce,
    sign,
  };
}

// 创建本地连接，提供 offer
function ajaxPost(url, data) {
  return $.ajax({
    type: 'post',
    url,
    crossDomain: true,
    data: JSON.stringify(data),
    contentType: 'application/json',
    dataType: 'json',
  });
}

function errorHandle(name, e) {
  console.warn(`${name} =>`);
  console.error(e);
}

function log(name, msg) {
  console.warn(`${name} =>`);
  console.log(msg);
}

function normalizeParams(data) {
  return Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('&')
}
