/*
 * @Author: 张文Uncle
 * @Email: 861182774@qq.com
 * @Date: 2019-11-19 09:01:18
 * @LastEditors: Please set LastEditors
 * @LastEditTime: 2019-12-17 11:23:08
 * @Descripttion: 
 */
import axios from 'axios';
import { Loading, Message } from 'element-ui';
import store from './src/store/store';
import _ from 'lodash';
import Router from './src/router/index'
import qs from 'querystring';
const baseURL = 'https://location';
let loading;
let needLoadingRequestCount = 0;
let refresh_token = true;
let logoutMessage = true;
function getLocalToken() {
	return store.state.edc_user;
}
function showLoading(target) {
	// 后面这个判断很重要，因为关闭时加了抖动，此时loading对象可能还存在，
	// 但needLoadingRequestCount已经变成0.避免这种情况下会重新创建个loading
	if (needLoadingRequestCount === 0 && !loading) {
		loading = Loading.service({
			lock: true,
			fullscreen: true,
			text: "努力加载中...",
			background: 'rgba(255, 255, 255, 0.7)',
			target: target || "body"
		});
	}
	needLoadingRequestCount++;
}
//隐藏loading
function hideLoading() {
	needLoadingRequestCount--;
	needLoadingRequestCount = Math.max(needLoadingRequestCount, 0); //做个保护
	if (needLoadingRequestCount === 0) {
		//关闭loading
		toHideLoading();
	}
}
var toHideLoading = _.debounce(() => {
	if (loading) {
		loading.close()
	}
	loading = null;
})


function refreshToken() {
	var obj = getLocalToken();
	return $http.post('/user/refresh-access-token', { refresh_token: obj.refresh_token }).then(res => res.data)
}
function dataURLtoFile(dataurl, filename = "file") {
	if (typeof (dataurl) == 'object') {
		return new File([dataurl], `${filename}.jpg`, { type: 'jpg' });
	}
	let arr = dataurl.split(",");
	let mime = arr[0].match(/:(.*?);/)[1];
	let suffix = mime.split("/")[1];
	let bstr = atob(arr[1]);
	let n = bstr.length;
	let u8arr = new Uint8Array(n);
	while (n--) {
		u8arr[n] = bstr.charCodeAt(n);
	}
	return new File([u8arr], `${filename}.${suffix}`, { type: mime });
}

const $http = axios.create({
	baseURL: baseURL,
	timeout: 5000,
	headers: {
		'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8;',
		'Access-Control-Max-Age': 3600,
	},
	transformRequest: [function (data, headers) {
		return qs.stringify(data);
	}],
})
$http.reLogin = function () {
	Router.push({
		path: '/',
		query: {
			redirect: location.hostname  // 防止从外部进来登录
		}
	})
}
$http.getObjectURL = function (file) {
	var url = null;
	if (window.createObjectURL != undefined) {
		// basic
		url = window.createObjectURL(file);
	} else if (window.URL != undefined) {
		// mozilla(firefox)
		url = window.URL.createObjectURL(file);
	} else if (window.webkitURL != undefined) {
		// webkit or chrome
		url = window.webkitURL.createObjectURL(file);
	}
	return url;
}
$http.logout = function () {
	store.commit('saveEdcUser', {
		refresh_token: '',
		access_token: '',
		expire_time: ''
	});
	localStorage.clear();
}
//文件上传
$http.upload = function (url, opt) {
	let obj = {
		name: '',
		image: '',
		file: '',
		params: {},
	}
	_.merge(obj, opt);
	let formData = new FormData();
	if (obj.image != '') {
		formData.append(obj.name, dataURLtoFile(obj.image));
	} else {
		formData.append(obj.name, obj.file);
	}
	if (obj.params) {
		_.keys(obj.params).forEach(key => {
			formData.append(key, obj.params[key]);
		})
	}
	return $http.post(url, formData, {
		headers: {
			'Content-Type': 'multipart/form-data',
		},
		transformRequest: [function (data, headers) {
			return data;
		}],
	})
}
//文件下载
$http.download = function (url, params) {
	$http.post(url, params, {
		responseType: 'blob/json',
	}).then(res => {
		let data = res.data;
		if (data.code) {
			Message(data.message);
		} else {
			let blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8" });
			let url = $http.getObjectURL(blob);
			let link = document.createElement('a');
			let contentDisposition = res.headers['content-disposition'];  //从response的headers中获取filename
			let patt = new RegExp("filename=([^;]+\\.[^\\.;]+);*");
			let result = patt.exec(contentDisposition);
			let filename = decodeURI(result[1]);
			link.style.display = 'none';
			link.href = url;
			link.setAttribute('download', filename);
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link);
		}
	}).catch(err => {
		console.error(err);
	})
}
$http.interceptors.request.use(request => {
	if (request.headers.showLoading !== false) {
		showLoading(request.headers.loadingTarget);
	}
	var token = getLocalToken();
	//判断过期时间刷新token
	if (token.expire_time !== '' && token.expire_time < (new Date()).getTime() / 1000 + 600 && refresh_token) {
		refresh_token = false;
		let promisefresh = new Promise(function (resolve, reject) {
			return refreshToken().then(res => {
				if (res.code != 1000) {
					//无效的令牌
					$http.logout();
					$http.reLogin();
				}
				hideLoading();
				refresh_token = true;
				const token = res.data;
				token.expire_time += (new Date()).getTime() / 1000;
				request.headers['Authorization'] = token.access_token ? `Bearer ${token.access_token}` : '';
				store.commit('saveEdcUser', token);
				location.reload();
				resolve(request);
			}).catch(res => {
				//刷新失败 重新登录
				$http.logout();
				console.error('error =>', res);
				$http.reLogin();
			})
		})
		return promisefresh;
	}
	request.headers['Authorization'] = getLocalToken().access_token ? `Bearer ${getLocalToken().access_token}` : '';
	return request;
}, error => {
	hideLoading();
})
$http.interceptors.response.use(response => {
	let code = response.data.code
	hideLoading();
	//权限不足  回退上一页
	if (code == '1008') {
		history.go(-1);
	}
	if (!(response.data || response.data.data)) {
		response.data.data = [];
	}
	return response;
}, error => {
	hideLoading();
	if (error.response.status === 401) {
		if (logoutMessage) {
			logoutMessage = false;
			Message('您的账号已在别处登录');
		}
		$http.logout();
		$http.reLogin();
	} else {
		let res = error.response;
		console.log(res);

		Message({
			message: `<p style="text-align: justify;">ERROR: <span style='color:red;'>${res.status} ${res.statusText}</span></p>
					  <p style="text-align: justify;">Message: <span style='color:red;'>"${res.data.message}"</span></p>
					  <p style="text-align: justify;">File: <span style='color:red;'>"${res.data.file}"</span></p>
					  <p style="text-align: justify;">Line: <span style='color:red;'>${res.data.line}</span></p>`,
			duration: 0,
			center: false,
			showClose: true,
			dangerouslyUseHTMLString: true,
		});
	}
})

export default $http;
